#!/usr/bin/env python3
"""Scan one page to a JPEG through the configured scanner host."""

import argparse
import json
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path


SCAN_SETTINGS = b'''<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <pwg:InputSource>Platen</pwg:InputSource>
  <scan:ColorMode>RGB24</scan:ColorMode>
  <scan:XResolution>300</scan:XResolution>
  <scan:YResolution>300</scan:YResolution>
</scan:ScanSettings>
'''


def read(url, context):
    with urllib.request.urlopen(url, timeout=45, context=context) as response:
        return response.read()


def scanner_state(base, context):
    root = ET.fromstring(read(f'{base}/eSCL/ScannerStatus', context))
    state = next((item.text.strip() for item in root.iter()
                  if item.tag.rsplit('}', 1)[-1] == 'State' and item.text), None)
    if not state:
        raise RuntimeError('Scanner status has no state')
    return state


def load_config(path):
    return json.loads(path.read_text())


def discover_scanner(context, config):
    browse = subprocess.run(['timeout', '8', 'avahi-browse', '-rt', '_uscan._tcp'],
                            text=True, capture_output=True, check=False).stdout
    bases = []
    for service in re.split(r'(?m)^=\s*', browse):
        if config['device_name'] in service:
            address = re.search(r'address = \[(\d+\.\d+\.\d+\.\d+)\]', service)
            port = re.search(r'port = \[(\d+)\]', service)
            if address:
                bases.append(f'https://{address.group(1)}:{port.group(1) if port else 443}')
    bases.append(config['scanner_url'])
    for base in dict.fromkeys(bases):
        try:
            return base, scanner_state(base, context)
        except (OSError, ET.ParseError):
            continue
    raise RuntimeError('Scanner not reachable')


def remote_scan(config):
    context = ssl._create_unverified_context()  # The scanner has a self-signed certificate.
    base, state = discover_scanner(context, config)
    if state != 'Idle':
        raise RuntimeError(f'Scanner is not idle: {state}')

    request = urllib.request.Request(f'{base}/eSCL/ScanJobs', data=SCAN_SETTINGS,
                                     headers={'Content-Type': 'text/xml'}, method='POST')
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        if response.status != 201:
            raise RuntimeError(f'Scan request returned HTTP {response.status}')
        location = response.headers.get('Location')
    if not location:
        raise RuntimeError('Scan request returned no job location')

    document_url = urllib.parse.urljoin(base, location).rstrip('/') + '/NextDocument'
    for _ in range(90):
        try:
            image = read(document_url, context)
            break
        except urllib.error.HTTPError as error:
            if error.code != 503:
                raise
            time.sleep(1)
    else:
        raise RuntimeError('Scan job started but no image was ready; check the scanner before retrying')
    if not image.startswith(b'\xff\xd8'):
        raise RuntimeError('Scanner did not return a JPEG')

    try:
        read(document_url, context)  # A 404 closes the one-page platen job.
        print('Warning: scanner returned another document after the first page', file=sys.stderr)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            print(f'Warning: scanner release returned HTTP {error.code}', file=sys.stderr)
    except OSError as error:
        print(f'Warning: scanner release could not be confirmed: {error}', file=sys.stderr)
    try:
        state = scanner_state(base, context)
        if state != 'Idle':
            print(f'Warning: scanner state is {state}', file=sys.stderr)
    except (OSError, ET.ParseError) as error:
        print(f'Warning: scanner state could not be confirmed: {error}', file=sys.stderr)
    sys.stdout.buffer.write(image)


def local_scan(output):
    output = output.expanduser().resolve()
    if output.suffix.lower() not in ('.jpg', '.jpeg'):
        raise ValueError('Output must be a .jpg or .jpeg file')
    if not output.parent.is_dir():
        raise ValueError(f'Output directory does not exist: {output.parent}')
    if output.exists():
        raise FileExistsError(f'Output already exists: {output}')
    config_path = Path(__file__).resolve().parents[1] / 'config.json'
    host = load_config(config_path)['ssh_host']
    remote_dir = '/tmp/physical-scan-' + uuid.uuid4().hex
    try:
        subprocess.run(['ssh', '-o', 'BatchMode=yes', host, 'mkdir', '-m', '700', remote_dir], check=True, capture_output=True)
        subprocess.run(['scp', '-q', str(Path(__file__).resolve()), str(config_path), f'{host}:{remote_dir}/'], check=True, capture_output=True)
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host,
                                 'python3', f'{remote_dir}/scan-page.py', '--remote', '--config',
                                 f'{remote_dir}/{config_path.name}'], capture_output=True, timeout=240)
    finally:
        subprocess.run(['ssh', '-o', 'BatchMode=yes', host, 'rm', '-rf', remote_dir], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace').strip() or 'Remote scan failed')
    if not result.stdout.startswith(b'\xff\xd8'):
        raise RuntimeError('Remote scan returned no JPEG')
    with output.open('xb') as file:
        file.write(result.stdout)
    if result.stderr:
        print(result.stderr.decode(errors='replace').strip(), file=sys.stderr)
    print(f'Saved {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', type=Path, help='Path for the scanned JPEG')
    parser.add_argument('--remote', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--config', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.remote:
        remote_scan(load_config(args.config))
    elif args.output:
        local_scan(args.output)
    else:
        parser.error('provide an output path')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Scan failed: {error}', file=sys.stderr)
        sys.exit(1)

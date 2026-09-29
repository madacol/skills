#!/usr/bin/env python3
"""Print a PDF, optionally selecting one page."""

import argparse
import json
import re
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip() or result.stdout.strip()}')
    return result.stdout


def load_config(path):
    return json.loads(path.read_text())


def attribute(tag, name, value):
    name = name.encode()
    value = value.encode() if isinstance(value, str) else value
    return bytes([tag]) + struct.pack('>H', len(name)) + name + struct.pack('>H', len(value)) + value


def ipp_payload(operation, uri, *, media=None, job_id=None, document=b''):
    operation_attributes = [
        attribute(0x47, 'attributes-charset', 'utf-8'),
        attribute(0x48, 'attributes-natural-language', 'en'),
        attribute(0x45, 'printer-uri', uri),
    ]
    if job_id is not None:
        operation_attributes.append(attribute(0x21, 'job-id', struct.pack('>I', job_id)))
    if media:
        operation_attributes.extend([
            attribute(0x42, 'requesting-user-name', 'mada'),
            attribute(0x42, 'job-name', 'PDF single page'),
            attribute(0x49, 'document-format', 'image/jpeg'),
        ])
    payload = struct.pack('>BBHI', 2, 0, operation, 1) + b'\x01' + b''.join(operation_attributes)
    if media:
        payload += b'\x02' + b''.join([
            attribute(0x44, 'media', media),
            attribute(0x21, 'copies', struct.pack('>I', 1)),
            attribute(0x44, 'sides', 'one-sided'),
        ])
    return payload + b'\x03' + document


def ipp_call(operation, uri, **kwargs):
    url = uri.replace('ipps://', 'https://', 1)
    request = urllib.request.Request(url, ipp_payload(operation, uri, **kwargs), {'Content-Type': 'application/ipp'})
    with urllib.request.urlopen(request, timeout=30, context=ssl._create_unverified_context()) as response:
        body = response.read()
    status = struct.unpack('>H', body[2:4])[0]
    if status != 0:
        raise RuntimeError(f'IPP returned {status:#06x}; no automatic retry')
    return body


def value(body, name):
    needle = name.encode()
    index = body.find(struct.pack('>H', len(needle)) + needle)
    if index < 0:
        raise RuntimeError(f'IPP response has no {name}')
    start = index + 2 + len(needle)
    size = struct.unpack('>H', body[start:start + 2])[0]
    return body[start + 2:start + 2 + size]


def discover_printer(config):
    result = subprocess.run(['timeout', '8', 'avahi-browse', '-rt', '_ipps._tcp'], text=True, capture_output=True)
    browse = result.stdout
    service = next((part for part in re.split(r'(?m)^=\s*', browse) if config['device_name'] in part), '')
    address = re.search(r'address = \[(\d+\.\d+\.\d+\.\d+)\]', service)
    port = re.search(r'port = \[(\d+)\]', service)
    resource = re.search(r'"rp=([^\"]+)"', service)
    if address and port and resource and 'image/jpeg' in service:
        return f'ipps://{address.group(1)}:{port.group(1)}/{resource.group(1)}'
    return config['printer_uri']


def remote_print(jpeg, media, check_only, config):
    uri = discover_printer(config)
    capabilities = ipp_call(0x000B, uri)
    if config['device_name'].encode() not in capabilities or media.encode() not in capabilities or b'image/jpeg' not in capabilities:
        raise RuntimeError(f'Configured printer with {media} and JPEG was not found')
    ipp_call(0x0004, uri, media=media)  # Validate-Job: no paper is printed.
    if check_only:
        print(f'Validated {media} and JPEG on {uri}; no print job sent')
        return
    response = ipp_call(0x0002, uri, media=media, document=jpeg.read_bytes())
    job_id = struct.unpack('>I', value(response, 'job-id'))[0]
    for _ in range(10):
        result = ipp_call(0x0009, uri, job_id=job_id)
        state = struct.unpack('>I', value(result, 'job-state'))[0]
        if state == 9:
            print(f'Job {job_id}: completed successfully, one page, one copy, {media}')
            return
        if state in (7, 8):
            raise RuntimeError(f'Job {job_id} ended in state {state}; do not resend before checking printer')
        time.sleep(2)
    raise RuntimeError(f'Job {job_id} submitted but completion was not confirmed; check the printer before retrying')


def local_print(pdf, page, check_only):
    config_path = Path(__file__).resolve().parents[1] / 'config.json'
    host = load_config(config_path)['ssh_host']
    if not pdf.is_file() or pdf.suffix.lower() != '.pdf':
        raise ValueError('Provide an existing PDF file')
    info = run('pdfinfo', str(pdf))
    count = re.search(r'^Pages:\s+(\d+)$', info, re.MULTILINE)
    if not count:
        raise RuntimeError('Cannot determine PDF page count')
    total = int(count.group(1))
    if page is not None and not 1 <= page <= total:
        raise ValueError(f'Page must be between 1 and {total}')
    selected = [page] if page is not None else range(1, total + 1)
    with tempfile.TemporaryDirectory(prefix='physical-print-') as temporary:
        directory = Path(temporary)
        pages = []
        for number in selected:
            prefix = directory / f'page-{number}'
            one_page = prefix.with_suffix('.pdf')
            run('pdfseparate', '-f', str(number), '-l', str(number), str(pdf), str(one_page))
            info = run('pdfinfo', str(one_page))
            match = re.search(r'Page size:\s+([\d.]+) x ([\d.]+) pts', info)
            if not match:
                raise RuntimeError(f'Cannot determine page {number} size')
            width, height = map(float, match.groups())
            if abs(width - 595) < 3 and abs(height - 842) < 3:
                media = 'iso_a4_210x297mm'
            elif abs(width - 612) < 3 and abs(height - 792) < 3:
                media = 'na_letter_8.5x11in'
            else:
                raise ValueError(f'Unsupported page {number} size: {width:g} x {height:g} pt')
            run('pdftoppm', '-f', '1', '-l', '1', '-singlefile', '-jpeg', '-r', '300', str(one_page), str(prefix))
            pages.append((number, prefix.with_suffix('.jpg'), media))
        remote_dir = '/tmp/physical-print-' + uuid.uuid4().hex
        try:
            run('ssh', '-o', 'BatchMode=yes', host, 'mkdir', '-m', '700', remote_dir)
            run('scp', '-q', *(str(image) for _, image, _ in pages), str(Path(__file__).resolve()), str(config_path), f'{host}:{remote_dir}/')
            for number, image, media in pages:
                command = ['ssh', '-o', 'BatchMode=yes', host, 'python3', f'{remote_dir}/print-pdf.py', '--remote',
                           f'{remote_dir}/{image.name}', '--media', media, '--config', f'{remote_dir}/{config_path.name}']
                if check_only:
                    command.append('--check')
                print(f'Page {number}/{total}: {run(*command).strip()}')
        finally:
            subprocess.run(['ssh', '-o', 'BatchMode=yes', host, 'rm', '-rf', remote_dir], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--page', type=int)
    parser.add_argument('--check', action='store_true', help='Validate without printing')
    parser.add_argument('--remote', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--media', help=argparse.SUPPRESS)
    parser.add_argument('--config', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.remote:
        remote_print(args.file, args.media, args.check, load_config(args.config))
    else:
        local_print(args.file.resolve(), args.page, args.check)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Print failed: {error}', file=sys.stderr)
        sys.exit(1)

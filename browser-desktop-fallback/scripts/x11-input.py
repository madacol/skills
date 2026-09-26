#!/usr/bin/env python3
"""Send desktop input to an existing X11 display without browser automation APIs."""

import ctypes
import sys
import time

x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
x11.XFlush.argtypes = [ctypes.c_void_p]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]

display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("Cannot open DISPLAY")

shifted = dict(zip('!@#$%^&*()_+{}|:"<>?~', '1234567890-=[]\\;\',./`'))
named = {
    "\n": "Return",
    "\t": "Tab",
    " ": "space",
    "'": "apostrophe",
    "-": "minus",
    ".": "period",
    "/": "slash",
    ",": "comma",
    "=": "equal",
    ";": "semicolon",
    "[": "bracketleft",
    "]": "bracketright",
    "\\": "backslash",
    "`": "grave",
}


def rawkey(name, press):
    sym = x11.XStringToKeysym(name.encode())
    code = x11.XKeysymToKeycode(display, sym)
    if not code:
        raise ValueError(f"No keycode for {name}")
    xtst.XTestFakeKeyEvent(display, code, press, 0)
    x11.XFlush(display)


def key(name):
    rawkey(name, 1)
    rawkey(name, 0)
    time.sleep(0.04)


def combo(modifier, name):
    rawkey(modifier, 1)
    key(name)
    rawkey(modifier, 0)


def type_text(value):
    if not value.isascii():
        raise ValueError("The XTest input helper supports ASCII only")
    for char in value:
        shift = char.isupper() or char in shifted
        name = named.get(char, shifted.get(char, char.lower() if shift else char))
        if shift:
            rawkey("Shift_L", 1)
        key(name)
        if shift:
            rawkey("Shift_L", 0)
        time.sleep(0.005)


def move(x, y):
    xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
    x11.XFlush(display)
    time.sleep(0.15)


action = sys.argv[1]
if action == "move":
    move(*map(int, sys.argv[2:4]))
elif action == "click":
    move(*map(int, sys.argv[2:4]))
    xtst.XTestFakeButtonEvent(display, 1, 1, 0)
    xtst.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
elif action == "key":
    key(sys.argv[2])
elif action == "combo":
    combo(sys.argv[2], sys.argv[3])
elif action == "type":
    type_text(sys.argv[2])
elif action == "scroll":
    count = int(sys.argv[2])
    button = 5 if count > 0 else 4
    for _ in range(abs(count)):
        xtst.XTestFakeButtonEvent(display, button, 1, 0)
        xtst.XTestFakeButtonEvent(display, button, 0, 0)
        x11.XFlush(display)
        time.sleep(0.04)
else:
    raise ValueError(action)

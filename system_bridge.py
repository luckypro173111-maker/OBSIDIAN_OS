import http.server
import socketserver
import subprocess
import platform
import json
import threading
import sys
import os
import asyncio
from typing import Optional

try:
    import pystray
    from pystray import MenuItem as item
    from PIL import Image, ImageDraw
except ImportError:
    print("Warning: 'pystray' and/or 'Pillow' missing. Tray icon disabled.")

try:
    from ctypes import cast, POINTER
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
except ImportError:
    print("Warning: 'pycaw' or 'comtypes' missing. Volume controls disabled. Run: pip install pycaw comtypes")

try:
    from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager
except ImportError:
    print("Warning: 'winsdk' missing. Media metadata disabled. Run: pip install winsdk")


PORT = 5501
current_ssid = "Scanning..."

# --- 1. SSID LOGIC ---
def get_current_wifi_name():
    system = platform.system()
    try:
        if system == "Windows":
            result = subprocess.check_output(["netsh", "wlan", "show", "interfaces"]).decode("utf-8", errors="ignore")
            for line in result.split('\n'):
                if " SSID" in line and "BSSID" not in line:
                    return line.split(":")[1].strip()
    except Exception:
        pass
    return "Not Connected"

def update_ssid_cache():
    global current_ssid
    current_ssid = get_current_wifi_name()

# --- 2. MEDIA LOGIC ---
async def get_media_info():
    try:
        manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        session = manager.get_current_session()
        if not session:
            return {"title": "No media playing", "artist": "", "playing": False}
        
        info = await session.try_get_media_properties_async()
        playback_info = session.get_playback_info()
        is_playing = playback_info.playback_status == 4 # 4 = Playing
        
        return {
            "title": info.title or "Unknown Title",
            "artist": info.artist or "Unknown Artist",
            "playing": is_playing
        }
    except Exception as e:
        return {"title": "Media info error", "artist": str(e), "playing": False}

async def send_media_command(command):
    try:
        manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        session = manager.get_current_session()
        if not session:
            return False
        
        if command == "play_pause":
            await session.try_toggle_play_pause_async()
        elif command == "next":
            await session.try_skip_next_async()
        elif command == "prev":
            await session.try_skip_previous_async()
        return True
    except:
        return False

def get_volume():
    try:
        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        return volume.GetMasterVolumeLevelScalar() * 100
    except:
        return 0

def set_volume(level):
    try:
        level = max(0.0, min(1.0, float(level) / 100.0))
        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        volume.SetMasterVolumeLevelScalar(level, None)
        return True
    except:
        return False

# Asyncio wrapper
def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)

# --- 3. HTTP SERVER ---
class APIRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-type")
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/ssid':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            update_ssid_cache()
            response = {"ssid": current_ssid}
            self.wfile.write(json.dumps(response).encode('utf-8'))
        elif self.path == '/api/media':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            media_info = run_async(get_media_info()) if 'GlobalSystemMediaTransportControlsSessionManager' in globals() else {"title": "winsdk required", "artist": "", "playing": False}
            media_info['volume'] = int(get_volume() if 'IAudioEndpointVolume' in globals() else 0)
            
            self.wfile.write(json.dumps(media_info).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/media/control':
            content_length = int(self.headers['Content-Length'])
            post_data = json.loads(self.rfile.read(content_length))
            cmd = post_data.get('command')
            
            if cmd in ['play_pause', 'next', 'prev']:
                run_async(send_media_command(cmd))
            elif cmd == 'volume':
                set_volume(post_data.get('value', 50))
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))

    def log_message(self, format, *args):
        pass

def run_server():
    with socketserver.TCPServer(("", PORT), APIRequestHandler) as httpd:
        httpd.serve_forever()

if __name__ == "__main__":
    api_thread = threading.Thread(target=run_server, daemon=True)
    api_thread.start()
    
    print(f"System Bridge API listening on port {PORT}")
    
    # If pystray is not installed, just block main thread
    if 'pystray' not in sys.modules:
        import time
        while True:
            time.sleep(1)
            
    # Tray icon logic
    width = 64
    height = 64
    image = Image.new('RGB', (width, height), (20, 19, 20))
    dc = ImageDraw.Draw(image)
    dc.ellipse([10, 10, 54, 54], outline=(243, 187, 153), width=4)
    dc.point([32, 32], fill=(243, 187, 153))

    def on_quit(icon, item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(item("System Bridge Active", lambda: None, enabled=False), item("Exit", on_quit))
    icon = pystray.Icon("ObsidianBridge", image, "Obsidian OS System Bridge", menu)
    icon.run()

import http.server
import socketserver
import subprocess
import platform
import json
import threading
import sys
import os
from PIL import Image, ImageDraw

# Only import pystray if needed (or warn if missing)
try:
    import pystray
    from pystray import MenuItem as item
except ImportError:
    print("Error: 'pystray' library not found. Please run: pip install pystray Pillow")
    sys.exit(1)

PORT = 5501
current_ssid = "Scanning..."

def get_current_wifi_name():
    system = platform.system()
    try:
        if system == "Windows":
            result = subprocess.check_output(["netsh", "wlan", "show", "interfaces"]).decode("utf-8", errors="ignore")
            for line in result.split('\n'):
                if " SSID" in line and "BSSID" not in line:
                    return line.split(":")[1].strip()
        elif system == "Darwin":
            result = subprocess.check_output(["/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", "-I"]).decode("utf-8", errors="ignore")
            for line in result.split('\n'):
                if " SSID" in line:
                    return line.split(":")[1].strip()
        elif system == "Linux":
            result = subprocess.check_output(["iwgetid", "-r"]).decode("utf-8", errors="ignore")
            return result.strip()
    except Exception:
        pass
    return "Not Connected"

def update_ssid_cache():
    global current_ssid
    current_ssid = get_current_wifi_name()

class SSIDRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/ssid':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            update_ssid_cache()
            response = {"ssid": current_ssid}
            self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

def run_server():
    with socketserver.TCPServer(("", PORT), SSIDRequestHandler) as httpd:
        httpd.serve_forever()

# --- System Tray Icon Logic ---
def create_image():
    # Create a 64x64 icon (Circular Obsidian-style theme)
    width = 64
    height = 64
    image = Image.new('RGB', (width, height), (20, 19, 20)) # --bg-base
    dc = ImageDraw.Draw(image)
    # Draw a stylized "O" or circle with the accent color
    dc.ellipse([10, 10, 54, 54], outline=(243, 187, 153), width=4) # --text-primary
    dc.point([32, 32], fill=(243, 187, 153))
    return image

def on_quit(icon, item):
    icon.stop()
    os._exit(0)

def on_refresh(icon, item):
    update_ssid_cache()
    # Pystray menu is dynamic, but title updates need to be handled by recreating icon or menu
    # For now, we'll just log the refresh.
    print(f"Network refreshed. Current: {current_ssid}")

def setup_tray():
    update_ssid_cache()
    image = create_image()
    menu = pystray.Menu(
        item(f"Network: {current_ssid}", lambda: None, enabled=False),
        item("Refresh Scan", on_refresh),
        item("Quit Obsidian Utility", on_quit)
    )
    icon = pystray.Icon("Obsidian SSID Utility", image, "Obsidian Network Utility", menu)
    icon.run()

if __name__ == "__main__":
    # Start the local API in a background thread
    api_thread = threading.Thread(target=run_server, daemon=True)
    api_thread.start()
    
    print(f"Obsidian SSID API listening on port {PORT}")
    print("System Tray Icon is active. (Look at your taskbar)")
    
    # Start the system tray loop (must be on main thread)
    setup_tray()

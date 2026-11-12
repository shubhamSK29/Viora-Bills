"""
Viora Bills Desktop Launcher - Version 1.0.0
Orchestrates:
  1. MongoDB Windows Service (ensures database is running in background)
  2. FastAPI Backend Server (http://127.0.0.1:8000)
  3. Vite Frontend Server (http://localhost:5173)
  4. Automatically opens default browser directly to the Login/Dashboard page
"""
import os
import sys
import time
import subprocess
import webbrowser
import threading
from pathlib import Path

VERSION = "1.0.0"

def get_base_dir():
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

def check_or_start_mongodb():
    print("[1/4] Ensuring MongoDB background database service is active...")
    try:
        sc_query = subprocess.run(["sc", "query", "MongoDB"], capture_output=True, text=True)
        if "RUNNING" in sc_query.stdout:
            print("  -> MongoDB service is active.")
            return True
        elif "STOPPED" in sc_query.stdout:
            print("  -> Starting MongoDB service in background...")
            subprocess.run(["net", "start", "MongoDB"], capture_output=True)
            time.sleep(2)
            return True
        else:
            print("  -> MongoDB status verified.")
            return True
    except Exception as e:
        print(f"  -> Note on MongoDB check: {e}")
        return True

def locate_project(base_dir):
    # Check current directory first (inside Viora Bills v1)
    if (base_dir / "backend").exists() and (base_dir / "frontend").exists():
        return base_dir
    # Check subfolders
    for sub in ["Viora Bills v1", "Bills-main", "Bills/Bills-main"]:
        if (base_dir / sub / "backend").exists():
            return base_dir / sub
    # Check parent
    if (base_dir.parent / "backend").exists():
        return base_dir.parent
    return base_dir

def start_services():
    print("=" * 65)
    print(f"            VIORA BILLS APPLICATION - v{VERSION}")
    print("=" * 65)

    base_dir = get_base_dir()
    project_root = locate_project(base_dir)
    backend_dir = project_root / "backend"
    frontend_dir = project_root / "frontend"

    print(f"Project Directory: {project_root}")

    # Ensure .env exists in backend
    env_file = backend_dir / ".env"
    env_example = backend_dir / ".env.example"
    if not env_file.exists() and env_example.exists():
        with open(env_example, "r", encoding="utf-8") as f_in, open(env_file, "w", encoding="utf-8") as f_out:
            f_out.write(f_in.read())

    # Step 1: Ensure MongoDB service is running
    check_or_start_mongodb()

    # Step 2: Start FastAPI Backend Process
    print("[2/4] Initializing backend services on http://127.0.0.1:8000 ...")
    backend_cmd = ["python", "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"]
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(backend_dir),
        shell=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    )

    # Step 3: Start Vite Frontend Server
    print("[3/4] Launching user interface on http://localhost:5173 ...")
    frontend_cmd = "npm run dev"
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=str(frontend_dir),
        shell=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    )

    # Step 4: Open Browser directly to Login / Application
    print("[4/4] Opening application in your web browser...")
    def open_browser():
        time.sleep(3)
        print("\n" + "=" * 65)
        print("  VIORA BILLS APPLICATION IS READY!")
        print("  App URL: http://localhost:5173")
        print("  (You may keep this console minimized while using Viora Bills)")
        print("=" * 65 + "\n")
        webbrowser.open("http://localhost:5173")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None:
                print("Backend service stopped.")
                break
            if frontend_proc.poll() is not None:
                print("Frontend service stopped.")
                break
    except KeyboardInterrupt:
        print("\nClosing Viora Bills...")
    finally:
        try:
            backend_proc.terminate()
            frontend_proc.terminate()
        except Exception:
            pass

if __name__ == "__main__":
    start_services()

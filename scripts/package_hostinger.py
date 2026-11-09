#!/usr/bin/env python3
"""
Hostinger Deployment Zip Packager
Creates a production-ready, clean zip archive ready to upload directly to Hostinger hPanel File Manager.
"""
import os
import sys
import zipfile
import shutil
import subprocess

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST_DIR = os.path.join(ROOT_DIR, 'dist')
DOWNLOADS_DIR = os.path.join(ROOT_DIR, 'public', 'downloads')
ZIP_OUT_PATH = os.path.join(DOWNLOADS_DIR, 'yuhusulu_whatsapp_crm_hostinger.zip')

print(f"[Packager] Project root: {ROOT_DIR}")

# 1. Ensure production builds exist
os.chdir(ROOT_DIR)
print("[Packager] Compiling frontend (vite build)...")
subprocess.run(["npm", "run", "build"], check=True)

print("[Packager] Compiling backend server.js with esbuild...")
subprocess.run([
    "npx", "esbuild", "server.ts",
    "--platform=node",
    "--format=esm",
    "--outfile=server.js",
    "--packages=external"
], check=True)

os.makedirs(DOWNLOADS_DIR, exist_ok=True)
os.makedirs(os.path.join(ROOT_DIR, 'sessions'), exist_ok=True)
os.makedirs(os.path.join(ROOT_DIR, 'uploads'), exist_ok=True)

# Files & folders to include
INCLUDE_FILES = [
    'package.json',
    'server.ts',
    'server.js',
    'vite.config.ts',
    'tsconfig.json',
    'index.html',
    'metadata.json',
    '.env.example',
    'render.yaml',
    'railway.json',
    'Procfile',
    'Dockerfile',
    '.dockerignore',
    'RENDER_AND_RAILWAY_GUIDE.md',
    'HOSTINGER_A_TO_Z_GUIDE.md',
]

INCLUDE_DIRS = [
    'src',
    'dist',
    'public',
    'data',
    'sessions',
    'uploads',
]

EXCLUDE_EXTS = {'.pyc', '.git', '.DS_Store', '.zip'}
EXCLUDE_DIRS = {'node_modules', '.git', 'temp', 'downloads'}

print(f"[Packager] Generating zip at {ZIP_OUT_PATH}...")
if os.path.exists(ZIP_OUT_PATH):
    os.remove(ZIP_OUT_PATH)

with zipfile.ZipFile(ZIP_OUT_PATH, 'w', zipfile.ZIP_DEFLATED) as zipf:
    # Add files
    for fname in INCLUDE_FILES:
        fpath = os.path.join(ROOT_DIR, fname)
        if os.path.exists(fpath):
            zipf.write(fpath, fname)
            print(f"  + Added file: {fname}")

    # Add directories
    for dname in INCLUDE_DIRS:
        dir_path = os.path.join(ROOT_DIR, dname)
        if not os.path.exists(dir_path):
            continue
        for root, dirs, files in os.walk(dir_path):
            # Prune excluded dirs
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            
            # Record empty directory
            rel_dir = os.path.relpath(root, ROOT_DIR)
            if not files and not dirs:
                zipf.writestr(rel_dir + '/', '')

            for file in files:
                if any(file.endswith(ext) for ext in EXCLUDE_EXTS):
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, ROOT_DIR)
                zipf.write(full_path, rel_path)

zip_size_mb = os.path.getsize(ZIP_OUT_PATH) / (1024 * 1024)
print(f"[Packager] Success! Archive created: {ZIP_OUT_PATH} ({zip_size_mb:.2f} MB)")

# Also create copy for Railway/Render
CLOUD_ZIP_OUT = os.path.join(DOWNLOADS_DIR, 'yuhusulu_whatsapp_crm_cloud.zip')
shutil.copyfile(ZIP_OUT_PATH, CLOUD_ZIP_OUT)
print(f"[Packager] Success! Archive created: {CLOUD_ZIP_OUT} ({zip_size_mb:.2f} MB)")


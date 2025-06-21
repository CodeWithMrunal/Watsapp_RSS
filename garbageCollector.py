import os
from pathlib import Path

# List of directories you want to clean
directories_to_clean = [
    Path('backend/.wwebjs_auth'),
    Path('backend/.wwebjs_cache'),
    Path('backend/media'),
    Path('backend/rss'),
    Path('BestImg_Detection/best_images'),
    Path('BestImg_Detection/discarded_images'),
]

def delete_files_in_directory(directory):
    if not directory.exists() or not directory.is_dir():
        print(f"❌ Directory does not exist: {directory}")
        return

    deleted_count = 0
    for file in directory.iterdir():
        if file.is_file():
            try:
                file.unlink()
                deleted_count += 1
                print(f"🗑️ Deleted: {file}")
            except Exception as e:
                print(f"❌ Failed to delete {file}: {e}")
    
    if deleted_count == 0:
        print(f"📂 No files to delete in: {directory}")
    else:
        print(f"✅ Deleted {deleted_count} files from {directory}")

def main():
    print("🚀 Cleaning up specified directories...\n")
    for dir_path in directories_to_clean:
        delete_files_in_directory(dir_path)

if __name__ == "__main__":
    main()

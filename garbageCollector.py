from pathlib import Path
import shutil

# List of directories to delete completely
directories_to_delete = [
    Path('backend/.wwebjs_auth'),
    Path('backend/.wwebjs_cache'),
    Path('backend/media'),
    Path('backend/rss'),
    Path('BestImg_Detection/best_images'),
    Path('BestImg_Detection/discarded_images'),
]

for dir_path in directories_to_delete:
    if dir_path.exists() and dir_path.is_dir():
        print(f"🗑️ Deleting: {dir_path}")
        shutil.rmtree(dir_path)
    else:
        print(f"⚠️ Skipping (not found or not a directory): {dir_path}")

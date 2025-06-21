import os
import json
import shutil
from pathlib import Path
import cv2
import numpy as np
from datetime import datetime
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ImageQualitySelector:
    def __init__(self):
        self.media_dir = Path('../backend/media')
        self.best_images_dir = Path('./best_images')
        self.discarded_images_dir = Path('./discarded_images')
        self.media_json_path = Path('../backend/media/media.json')
        
        # Create output directories
        self.best_images_dir.mkdir(exist_ok=True)
        self.discarded_images_dir.mkdir(exist_ok=True)
        
        # Load OpenCV face detector
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
        
    def load_media_json(self):
        """Load and parse media.json file"""
        try:
            with open(self.media_json_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading media.json: {e}")
            return []
    
    def extract_image_paths(self, media_data):
        """Extract all image paths from media.json"""
        image_paths = []
        image_extensions = {'.jpg', '.jpeg', '.png', '.webp'}
        
        for entry in media_data:
            for media_item in entry.get('media', []):
                if media_item.get('type') == 'image' and media_item.get('mediaPath'):
                    path = media_item['mediaPath']
                    if Path(path).suffix.lower() in image_extensions:
                        image_paths.append({
                            'path': path,
                            'timestamp': media_item.get('timestamp'),
                            'author': entry.get('author'),
                            'groupId': entry.get('groupId'),
                            'caption': media_item.get('caption', '')
                        })
        
        return image_paths
    
    def calculate_sharpness(self, image):
        """Calculate image sharpness using Laplacian variance"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        variance = laplacian.var()
        
        # Normalize to 0-100 scale
        return min(100, variance / 10)
    
    def calculate_brightness(self, image):
        """Calculate average brightness"""
        # Convert to LAB color space
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l_channel = lab[:, :, 0]
        
        # Calculate mean brightness
        brightness = np.mean(l_channel)
        
        # Normalize to 0-100 scale
        return (brightness / 255) * 100
    
    def calculate_contrast(self, image):
        """Calculate image contrast using standard deviation"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        contrast = gray.std()
        
        # Normalize to 0-100 scale
        return min(100, (contrast / 128) * 100)
    
    def calculate_colorfulness(self, image):
        """Calculate colorfulness metric"""
        # Split channels
        (B, G, R) = cv2.split(image.astype("float"))
        
        # Compute rg and yb
        rg = np.absolute(R - G)
        yb = np.absolute(0.5 * (R + G) - B)
        
        # Compute mean and standard deviation
        rbMean = np.mean(rg)
        rbStd = np.std(rg)
        ybMean = np.mean(yb)
        ybStd = np.std(yb)
        
        # Combine mean and std
        stdRoot = np.sqrt((rbStd ** 2) + (ybStd ** 2))
        meanRoot = np.sqrt((rbMean ** 2) + (ybMean ** 2))
        
        # Calculate colorfulness
        colorfulness = stdRoot + (0.3 * meanRoot)
        
        # Normalize to 0-100 scale
        return min(100, colorfulness / 2)
    
    def analyze_faces(self, image):
        """Analyze faces in the image"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Detect faces
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 4)
        
        if len(faces) == 0:
            return {
                'hasFace': False,
                'faceCount': 0,
                'confidence': 0
            }
        
        # Analyze the largest face
        largest_face = max(faces, key=lambda f: f[2] * f[3])
        x, y, w, h = largest_face
        
        # Calculate face metrics
        image_height, image_width = image.shape[:2]
        face_area = (w * h) / (image_width * image_height) * 100
        
        # Check if face is centered
        face_center_x = (x + w/2) / image_width
        face_center_y = (y + h/2) / image_height
        is_centered = (0.2 < face_center_x < 0.8) and (0.2 < face_center_y < 0.8)
        
        # Check for eyes (indicates frontal face)
        face_roi_gray = gray[y:y+h, x:x+w]
        eyes = self.eye_cascade.detectMultiScale(face_roi_gray)
        is_frontal = len(eyes) >= 2
        
        # Calculate face quality score based on size and position
        face_score = min(100, face_area * 10)  # Larger faces get higher scores
        if is_centered:
            face_score += 20
        if is_frontal:
            face_score += 20
        
        return {
            'hasFace': True,
            'faceCount': len(faces),
            'faceArea': float(face_area),  # Convert to Python float
            'isCentered': bool(is_centered),  # Convert to Python bool
            'isFrontal': bool(is_frontal),  # Convert to Python bool
            'confidence': float(min(100, face_score)),  # Convert to Python float
            'faceBox': {'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h)}
        }
    
    def analyze_image_quality(self, image_path):
        """Analyze overall image quality"""
        try:
            full_path = Path(image_path).name
            full_path = self.media_dir / full_path
            
            if not full_path.exists():
                logger.warning(f"Image not found: {full_path}")
                return None
            
            # Read image
            image = cv2.imread(str(full_path))
            if image is None:
                logger.error(f"Failed to read image: {full_path}")
                return None
            
            # Calculate metrics
            metrics = {
                'sharpness': float(self.calculate_sharpness(image)),
                'brightness': float(self.calculate_brightness(image)),
                'contrast': float(self.calculate_contrast(image)),
                'colorfulness': float(self.calculate_colorfulness(image)),
                'resolution': int(image.shape[0] * image.shape[1]),
                'aspectRatio': float(image.shape[1] / image.shape[0])
            }
            
            # Analyze faces
            face_analysis = self.analyze_faces(image)
            
            # Calculate overall score
            score = self.calculate_overall_score(metrics, face_analysis)
            
            return {
                'path': image_path,
                'fullPath': str(full_path),
                'metrics': metrics,
                'faceAnalysis': face_analysis,
                'score': float(score)
            }
            
        except Exception as e:
            logger.error(f"Error analyzing {image_path}: {e}")
            return None
    
    def calculate_overall_score(self, metrics, face_analysis):
        """Calculate overall image quality score"""
        score = 0
        
        # Image quality metrics (40% weight)
        score += (metrics['sharpness'] / 100) * 10
        score += (10 if 30 < metrics['brightness'] < 70 else 5)  # Prefer mid-range brightness
        score += (metrics['contrast'] / 100) * 10
        score += (metrics['colorfulness'] / 100) * 10
        
        # Face analysis (60% weight)
        if face_analysis['hasFace']:
            score += 20  # Has face
            score += 15 if face_analysis['isCentered'] else 5
            score += 15 if face_analysis['isFrontal'] else 5
            score += (face_analysis['confidence'] / 100) * 10
        
        return score
    
    def generate_selection_reason(self, analysis):
        """Generate human-readable reason for selection"""
        reasons = []
        
        # Face detection reasons
        if analysis['faceAnalysis']['hasFace']:
            reasons.append(f"Face detected with {analysis['faceAnalysis']['confidence']:.0f}% confidence")
            
            if analysis['faceAnalysis']['isCentered']:
                reasons.append('Face is well-centered')
            
            if analysis['faceAnalysis']['isFrontal']:
                reasons.append('Face is facing camera')
            
            if analysis['faceAnalysis']['faceCount'] > 1:
                reasons.append(f"{analysis['faceAnalysis']['faceCount']} faces detected")
        
        # Image quality reasons
        if analysis['metrics']['sharpness'] > 70:
            reasons.append('Sharp and well-focused')
        
        if 30 < analysis['metrics']['brightness'] < 70:
            reasons.append('Good lighting')
        
        if analysis['metrics']['contrast'] > 60:
            reasons.append('Good contrast')
        
        if analysis['metrics']['colorfulness'] > 50:
            reasons.append('Vibrant colors')
        
        return ', '.join(reasons) if reasons else 'Selected based on overall quality'
    
    def copy_images(self, images, destination_dir, prefix):
        """Copy images to specified directory"""
        results = []
        
        for i, image in enumerate(images, 1):
            source_path = Path(image['fullPath'])
            dest_filename = f"{prefix}_{i}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{source_path.name}"
            dest_path = destination_dir / dest_filename
            
            try:
                shutil.copy2(source_path, dest_path)
                
                result = {
                    'rank': i,
                    'originalPath': image['path'],
                    'newPath': str(dest_path),
                    'score': round(image['score'], 2),
                    'reason': self.generate_selection_reason(image),
                    'metrics': image['metrics'],
                    'faceAnalysis': image['faceAnalysis']
                }
                
                results.append(result)
                logger.info(f"✅ Copied to {destination_dir.name}: {dest_filename}")
                logger.info(f"   Score: {result['score']}")
                logger.info(f"   Reason: {result['reason']}")
                
            except Exception as e:
                logger.error(f"Error copying {source_path}: {e}")
        
        return results
    
    def process_images(self, top_n=5):
        """Main processing function"""
        logger.info("🚀 Starting image quality selection process...")
        
        # Load media data
        media_data = self.load_media_json()
        logger.info(f"📂 Loaded {len(media_data)} entries from media.json")
        
        # Extract image paths
        image_paths = self.extract_image_paths(media_data)
        logger.info(f"🖼️  Found {len(image_paths)} images to analyze")
        
        # Analyze each image
        logger.info("🔍 Analyzing images...")
        analyzed_images = []
        
        for i, image_info in enumerate(image_paths, 1):
            logger.info(f"Processing {i}/{len(image_paths)}: {Path(image_info['path']).name}")
            
            analysis = self.analyze_image_quality(image_info['path'])
            if analysis:
                analyzed_images.append(analysis)
        
        logger.info(f"✅ Successfully analyzed {len(analyzed_images)} images")
        
        if not analyzed_images:
            logger.warning("No images were successfully analyzed")
            return
        
        # Sort by score and select top N
        analyzed_images.sort(key=lambda x: x['score'], reverse=True)
        best_images = analyzed_images[:top_n]
        discarded_images = analyzed_images[top_n:]
        
        logger.info(f"\n🏆 Selected top {len(best_images)} images")
        logger.info(f"🗑️  {len(discarded_images)} images will be moved to discarded folder")
        
        # Copy best images
        best_results = self.copy_images(best_images, self.best_images_dir, "best")
        
        # Copy discarded images
        discarded_results = self.copy_images(discarded_images, self.discarded_images_dir, "discarded")
        
        # Save results to JSON
        results_data = {
            'timestamp': datetime.now().isoformat(),
            'totalAnalyzed': len(analyzed_images),
            'topN': top_n,
            'bestImages': best_results,
            'discardedImages': discarded_results
        }
        
        # Save to best images directory
        best_results_path = self.best_images_dir / 'selection_results.json'
        with open(best_results_path, 'w') as f:
            json.dump(results_data, f, indent=2)
        
        # Save to discarded images directory
        discarded_results_path = self.discarded_images_dir / 'discarded_results.json'
        with open(discarded_results_path, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'discardedCount': len(discarded_results),
                'images': discarded_results
            }, f, indent=2)
        
        logger.info(f"\n📊 Results saved to: {best_results_path}")
        logger.info(f"📊 Discarded list saved to: {discarded_results_path}")
        logger.info("✨ Image selection process completed!")
        
        # Print summary
        print("\n" + "="*50)
        print("SUMMARY OF SELECTED IMAGES")
        print("="*50)
        for result in best_results:
            print(f"\nRank {result['rank']}: {Path(result['originalPath']).name}")
            print(f"Score: {result['score']}")
            print(f"Reason: {result['reason']}")
            print("-"*50)
        
        print("\n" + "="*50)
        print(f"DISCARDED IMAGES ({len(discarded_results)} total)")
        print("="*50)
        for result in discarded_results[:5]:  # Show first 5 discarded
            print(f"\n{Path(result['originalPath']).name}")
            print(f"Score: {result['score']}")
            print(f"Reason for discard: Low score - {result['reason']}")
        if len(discarded_results) > 5:
            print(f"\n... and {len(discarded_results) - 5} more images")


def main():
    # Create selector instance
    selector = ImageQualitySelector()
    
    # Process images and select top 5
    selector.process_images(top_n=5)


if __name__ == "__main__":
    main()
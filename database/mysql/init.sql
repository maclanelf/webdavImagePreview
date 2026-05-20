CREATE DATABASE IF NOT EXISTS webdav_image_preview
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE webdav_image_preview;

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE IF NOT EXISTS media_ratings (
  id BIGINT NOT NULL AUTO_INCREMENT,
  file_path VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(32) NOT NULL,
  rating TINYINT NULL,
  recommendation_reason TEXT NULL,
  custom_evaluation TEXT NULL,
  category TEXT NULL,
  is_viewed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_media_ratings_file_path (file_path),
  KEY idx_media_ratings_rating (rating),
  KEY idx_media_ratings_file_rating (file_path, rating),
  KEY idx_media_ratings_reason (recommendation_reason(191)),
  KEY idx_media_ratings_viewed (is_viewed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS group_ratings (
  id BIGINT NOT NULL AUTO_INCREMENT,
  group_path VARCHAR(512) NOT NULL,
  group_name VARCHAR(255) NOT NULL,
  file_count INT NOT NULL,
  rating TINYINT NULL,
  recommendation_reason TEXT NULL,
  custom_evaluation TEXT NULL,
  category TEXT NULL,
  is_viewed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_group_ratings_group_path (group_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS video_highlights (
  id BIGINT NOT NULL AUTO_INCREMENT,
  file_path VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  start_seconds DECIMAL(10,3) NOT NULL,
  end_seconds DECIMAL(10,3) NOT NULL,
  duration_seconds DECIMAL(10,3) NOT NULL,
  title VARCHAR(255) NULL,
  note TEXT NULL,
  tags TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_video_highlights_file_path (file_path),
  KEY idx_video_highlights_file_range (file_path, start_seconds, end_seconds)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS custom_evaluations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  label VARCHAR(255) NOT NULL,
  usage_count INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_custom_evaluations_label (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  usage_count INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS creators (
  id BIGINT NOT NULL AUTO_INCREMENT,
  primary_name VARCHAR(255) NOT NULL,
  other_names TEXT NULL,
  appearance_rating TINYINT NULL,
  body_rating TINYINT NULL,
  bio TEXT NULL,
  avatar_path VARCHAR(512) NULL,
  usage_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_creators_primary_name (primary_name),
  KEY idx_creators_primary_name (primary_name),
  KEY idx_creators_usage (usage_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS scan_cache (
  id BIGINT NOT NULL AUTO_INCREMENT,
  webdav_url VARCHAR(255) NOT NULL,
  webdav_username VARCHAR(191) NOT NULL,
  path VARCHAR(255) NOT NULL,
  files_data LONGTEXT NOT NULL,
  total_files INT NOT NULL,
  image_count INT NOT NULL,
  video_count INT NOT NULL,
  scan_settings TEXT NOT NULL,
  last_scan DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_scan_cache_unique (webdav_url, webdav_username, path),
  KEY idx_scan_cache_config (webdav_url, webdav_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS scheduled_scans (
  id BIGINT NOT NULL AUTO_INCREMENT,
  webdav_url VARCHAR(255) NOT NULL,
  webdav_username VARCHAR(191) NOT NULL,
  webdav_password TEXT NOT NULL,
  media_paths TEXT NOT NULL,
  scan_settings TEXT NOT NULL,
  cron_expression VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_run DATETIME NULL,
  next_run DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recursive_scan_tasks (
  id BIGINT NOT NULL AUTO_INCREMENT,
  task_id VARCHAR(191) NOT NULL,
  webdav_url VARCHAR(255) NOT NULL,
  webdav_username VARCHAR(191) NOT NULL,
  webdav_password TEXT NOT NULL,
  root_path VARCHAR(512) NOT NULL,
  scan_settings TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  current_path VARCHAR(512) NULL,
  scanned_directories INT NOT NULL DEFAULT 0,
  total_directories INT NOT NULL DEFAULT 0,
  found_files INT NOT NULL DEFAULT 0,
  pending_directories LONGTEXT NULL,
  completed_directories LONGTEXT NULL,
  error_message TEXT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  rate_limited_until DATETIME NULL,
  delay_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_recursive_scan_tasks_task_id (task_id),
  KEY idx_recursive_scan_tasks_status (status),
  KEY idx_recursive_scan_tasks_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS webdav_configs (
  id BIGINT NOT NULL AUTO_INCREMENT,
  url VARCHAR(255) NOT NULL,
  username VARCHAR(191) NOT NULL,
  password TEXT NOT NULL,
  media_paths TEXT NOT NULL,
  scan_settings TEXT NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  source_type VARCHAR(64) NOT NULL DEFAULT 'clouddrive2',
  direct_link_url VARCHAR(255) NULL,
  enable_direct_link TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_webdav_configs_url_username (url, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS scan_files (
  id BIGINT NOT NULL AUTO_INCREMENT,
  cache_id BIGINT NOT NULL,
  filename VARCHAR(512) NOT NULL,
  basename VARCHAR(255) NOT NULL,
  parent_path VARCHAR(512) NOT NULL,
  random_key INT UNSIGNED GENERATED ALWAYS AS (CRC32(filename)) STORED,
  parent_random_key INT UNSIGNED GENERATED ALWAYS AS (CRC32(parent_path)) STORED,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_type VARCHAR(32) NOT NULL,
  lastmod VARCHAR(64) NULL,
  is_viewed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_scan_files_unique (cache_id, filename),
  KEY idx_scan_files_cache (cache_id),
  KEY idx_scan_files_type (file_type),
  KEY idx_scan_files_viewed (is_viewed),
  KEY idx_scan_files_parent (parent_path),
  KEY idx_scan_files_query (cache_id, file_type, is_viewed),
  KEY idx_scan_files_cache_random (cache_id, random_key),
  KEY idx_scan_files_cache_viewed_random (cache_id, is_viewed, random_key),
  KEY idx_scan_files_cache_type_random (cache_id, file_type, random_key),
  KEY idx_scan_files_cache_parent_random (cache_id, parent_path, random_key),
  KEY idx_scan_files_cache_group_random (cache_id, parent_random_key, parent_path),
  KEY idx_scan_files_filename (filename),
  CONSTRAINT fk_scan_files_cache_id
    FOREIGN KEY (cache_id) REFERENCES scan_cache(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS scan_file_creators (
  id BIGINT NOT NULL AUTO_INCREMENT,
  file_path VARCHAR(512) NOT NULL,
  parent_path VARCHAR(512) NOT NULL,
  creator_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_scan_file_creators_file_path (file_path),
  KEY idx_scan_file_creators_parent_path (parent_path),
  KEY idx_scan_file_creators_creator_id (creator_id),
  CONSTRAINT fk_scan_file_creators_creator_id
    FOREIGN KEY (creator_id) REFERENCES creators(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO creators (id, primary_name, bio, usage_count)
SELECT -1, '不认识', '用于标记无法识别的博主', 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM creators
  WHERE id = -1 OR primary_name = '不认识'
);

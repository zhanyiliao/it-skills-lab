-- IT Skills Lab: current application schema.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS user (
  identity INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(30) NOT NULL,
  password VARCHAR(100) NOT NULL,
  role TINYINT NOT NULL DEFAULT 0,
  high_score DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (high_score BETWEEN 0 AND 100),
  reg_time BIGINT NOT NULL,
  last_login BIGINT NOT NULL DEFAULT -1,
  PRIMARY KEY (identity),
  UNIQUE KEY user_username_unique (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Original question bank for practice and daily questions. Codes are defined in src/services/ai-banks.js.
CREATE TABLE IF NOT EXISTS questions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 bank_code TINYINT UNSIGNED NOT NULL,
 question TEXT NOT NULL,
 A TEXT NOT NULL, B TEXT NOT NULL, C TEXT NOT NULL, D TEXT NOT NULL,
 answer CHAR(1) NOT NULL,
 explanation TEXT NOT NULL,
 difficulty TINYINT UNSIGNED NOT NULL,
 review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 appearance_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total appearances in legally submitted exams only',
 correct_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Correct answers in legally submitted exams only',
 unanswered_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Unanswered in legally submitted exams only',
 content_hash CHAR(64) NOT NULL,
 generator VARCHAR(40) NOT NULL,
 prompt_version CHAR(64) NOT NULL,
 generation_batch VARCHAR(80) NOT NULL,
 created_at BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (id),
 UNIQUE KEY questions_content_hash (content_hash),
 KEY questions_bank_review_difficulty (bank_code,review_status,difficulty),
 CONSTRAINT questions_answer CHECK (answer IN ('A','B','C','D')),
 CONSTRAINT questions_difficulty CHECK (difficulty BETWEEN 1 AND 9),
 CONSTRAINT questions_counts CHECK (correct_count + unanswered_count <= appearance_count),
 CONSTRAINT questions_bank CHECK (bank_code BETWEEN 0 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_records (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  started_at BIGINT UNSIGNED NOT NULL,
  submitted_at BIGINT UNSIGNED NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  elapsed_seconds INT UNSIGNED NOT NULL,
  details JSON NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  INDEX exam_records_recent (user_id, submitted_at, id),
  INDEX exam_records_high (user_id, score),
  CONSTRAINT exam_records_user FOREIGN KEY (user_id) REFERENCES user(identity) ON DELETE CASCADE,
  CONSTRAINT exam_records_score CHECK (score BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS node_active_exams (
  user_id INT NOT NULL,
  nonce CHAR(48) NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  exam JSON NOT NULL,
  answers JSON NOT NULL,
  page_token CHAR(32) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  visibility ENUM('visible','hidden') NOT NULL DEFAULT 'visible',
  last_seen_at BIGINT UNSIGNED NOT NULL,
  left_at BIGINT UNSIGNED NULL,
  result JSON NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY active_exam_nonce (nonce),
  INDEX active_exam_cleanup (last_seen_at),
  CONSTRAINT active_exam_user FOREIGN KEY (user_id) REFERENCES user(identity) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS node_sessions (
  id VARCHAR(128) PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX node_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS node_exam_submissions (
  nonce VARCHAR(48) PRIMARY KEY,
  user_id INT NOT NULL,
  submitted_at BIGINT NOT NULL,
  INDEX node_exam_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

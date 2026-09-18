CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(128) PRIMARY KEY,
  snapshot JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS stories (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  continuity_summary MEDIUMTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  team_id VARCHAR(128) NOT NULL,
  story_id CHAR(36) NULL,
  title VARCHAR(255) NOT NULL,
  brief MEDIUMTEXT NULL,
  phase VARCHAR(32) NOT NULL DEFAULT 'idle',
  snapshot JSON NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_projects_team_updated (team_id, updated_at),
  INDEX idx_projects_story (story_id),
  CONSTRAINT fk_projects_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(128) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  parent_task_id VARCHAR(128) NULL,
  title VARCHAR(255) NOT NULL,
  description MEDIUMTEXT NULL,
  assigned_agent_id INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  draft_output LONGTEXT NULL,
  review_comments TEXT NULL,
  output LONGTEXT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_tasks_project (project_id),
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(128) NOT NULL,
  revision_number INT NOT NULL,
  output LONGTEXT NOT NULL,
  feedback TEXT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_task_revision (task_id, revision_number),
  CONSTRAINT fk_revisions_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  scope VARCHAR(32) NOT NULL,
  scope_key VARCHAR(128) NOT NULL,
  summary MEDIUMTEXT NULL,
  UNIQUE KEY uq_conversation_scope (project_id, scope, scope_key),
  CONSTRAINT fk_conversations_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sequence_number INT NOT NULL,
  role VARCHAR(32) NOT NULL,
  content LONGTEXT NULL,
  name VARCHAR(255) NULL,
  tool_calls JSON NULL,
  metadata JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_message_sequence (conversation_id, sequence_number),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  asset_role VARCHAR(64) NOT NULL,
  media_type VARCHAR(32) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  storage_path VARCHAR(1024) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  checksum CHAR(64) NOT NULL,
  prompt LONGTEXT NULL,
  generation_params JSON NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  supersedes_asset_id CHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_assets_project_role (project_id, asset_role),
  CONSTRAINT fk_assets_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  asset_role VARCHAR(64) NOT NULL,
  prompt LONGTEXT NOT NULL,
  parameters JSON NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  error TEXT NULL,
  asset_id CHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_jobs_project (project_id),
  CONSTRAINT fk_jobs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS manhwa_chapters (
  project_id CHAR(36) PRIMARY KEY,
  story_id CHAR(36) NOT NULL,
  chapter_number INT NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL,
  premise MEDIUMTEXT NULL,
  end_hook MEDIUMTEXT NULL,
  continuity JSON NULL,
  CONSTRAINT fk_chapter_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_chapter_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS manhwa_characters (
  id VARCHAR(128) NOT NULL,
  story_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  visual_description MEDIUMTEXT NOT NULL,
  reference_prompt MEDIUMTEXT NOT NULL,
  relationships JSON NULL,
  world_state JSON NULL,
  reference_asset_id CHAR(36) NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, id),
  CONSTRAINT fk_character_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_asset FOREIGN KEY (reference_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS manhwa_panels (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  panel_number INT NOT NULL,
  visual MEDIUMTEXT NOT NULL,
  shot MEDIUMTEXT NOT NULL,
  image_prompt LONGTEXT NOT NULL,
  character_ids JSON NOT NULL,
  image_asset_id CHAR(36) NULL,
  UNIQUE KEY uq_project_panel (project_id, panel_number),
  CONSTRAINT fk_panel_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_panel_asset FOREIGN KEY (image_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS manhwa_panel_content (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  panel_id BIGINT UNSIGNED NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  sequence_number INT NOT NULL,
  speaker VARCHAR(255) NULL,
  content TEXT NOT NULL,
  placement VARCHAR(255) NULL,
  CONSTRAINT fk_panel_content_panel FOREIGN KEY (panel_id) REFERENCES manhwa_panels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(128) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

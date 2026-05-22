-- ============================================================
-- PalmDoor H5 - Supabase 数据库 Schema
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 设备表
CREATE TABLE IF NOT EXISTS devices (
  id BIGINT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sn TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '未命名',
  icon TEXT DEFAULT 'images/device-door.png',
  create_time TIMESTAMPTZ DEFAULT NOW(),
  online BOOLEAN DEFAULT FALSE,
  last_update TIMESTAMPTZ,
  status TEXT DEFAULT 'offline',
  disabled BOOLEAN DEFAULT FALSE,
  location TEXT DEFAULT '',
  version TEXT DEFAULT 'v1.0.0',
  last_online TEXT DEFAULT ''
);

-- 人员表
CREATE TABLE IF NOT EXISTS persons (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  user_id_text TEXT NOT NULL,
  card_no TEXT DEFAULT '',
  department TEXT DEFAULT '未分配部门',
  permission TEXT DEFAULT 'normal',
  palm_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active',
  device_sn TEXT DEFAULT ''
);

-- 考勤记录表
CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  work_number TEXT DEFAULT '',
  date TEXT DEFAULT '',
  check_time TEXT DEFAULT '',
  status TEXT DEFAULT '正常',
  device_sn TEXT DEFAULT ''
);

-- MQTT 配置表
CREATE TABLE IF NOT EXISTS mqtt_configs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================================
-- Row Level Security (RLS) - 确保每个用户只能访问自己的数据
-- ============================================================

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE mqtt_configs ENABLE ROW LEVEL SECURITY;

-- 先删除已有策略，再重建（避免重复执行报错）
DROP POLICY IF EXISTS "用户只能访问自己的设备" ON devices;
DROP POLICY IF EXISTS "用户只能访问自己的人员" ON persons;
DROP POLICY IF EXISTS "用户只能访问自己的考勤" ON attendance_records;
DROP POLICY IF EXISTS "用户只能访问自己的MQTT配置" ON mqtt_configs;

CREATE POLICY "用户只能访问自己的设备" ON devices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户只能访问自己的人员" ON persons
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户只能访问自己的考勤" ON attendance_records
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户只能访问自己的MQTT配置" ON mqtt_configs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_sn ON devices(user_id, sn);
CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id);
CREATE INDEX IF NOT EXISTS idx_persons_userid ON persons(user_id, user_id_text);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_device ON attendance_records(user_id, device_sn);

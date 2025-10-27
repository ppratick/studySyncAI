#!/usr/bin/env python3

import sqlite3
import os
from pathlib import Path

class Database:
    def __init__(self, db_path="backend/studysync.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_database()
    
    def init_database(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                due_at TEXT NOT NULL,
                course_name TEXT NOT NULL,
                reminder_list TEXT NOT NULL,
                ai_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_name TEXT UNIQUE NOT NULL,
                reminder_list TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def get_connection(self):
        return sqlite3.connect(self.db_path)
    
    def save_assignment(self, assignment_id, title, description, due_at, course_name, reminder_list, ai_notes=""):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO assignments 
            (assignment_id, title, description, due_at, course_name, reminder_list, ai_notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (assignment_id, title, description, due_at, course_name, reminder_list, ai_notes))
        
        conn.commit()
        conn.close()
    
    def get_assignment(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM assignments WHERE assignment_id = ?', (assignment_id,))
        result = cursor.fetchone()
        
        conn.close()
        return result
    
    def save_course_mapping(self, course_name, reminder_list):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO courses (course_name, reminder_list)
            VALUES (?, ?)
        ''', (course_name, reminder_list))
        
        conn.commit()
        conn.close()
    
    def get_course_mapping(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT reminder_list FROM courses WHERE course_name = ?', (course_name,))
        result = cursor.fetchone()
        
        conn.close()
        return result[0] if result else None
    
    def save_setting(self, key, value):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        ''', (key, value))
        
        conn.commit()
        conn.close()
    
    def get_setting(self, key):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
        result = cursor.fetchone()
        
        conn.close()
        return result[0] if result else None
    
    def get_all_assignments(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT assignment_id, title, description, due_at, course_name, reminder_list, ai_notes
            FROM assignments
            ORDER BY due_at ASC
        ''')
        
        results = cursor.fetchall()
        conn.close()
        return results

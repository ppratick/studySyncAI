#!/usr/bin/env python3

import os
import json
import requests
from datetime import datetime, timezone
from flask import Flask, render_template, jsonify, request, send_from_directory
from dotenv import load_dotenv
from pathlib import Path
from backend import Database, AIEnhancer, RemindersManager, CanvasAPI, AssignmentProcessor

load_dotenv()

app = Flask(__name__, template_folder='.', static_folder='.')

db = Database(db_path=str(Path(__file__).parent / "studysync-web.db"))
ai_enhancer = None
reminders_manager = RemindersManager()
canvas_api = None
processor = None

def initialize_components(ai_enabled=False):
    global ai_enhancer, canvas_api, processor
    
    api_token = os.getenv("CANVAS_API_TOKEN")
    canvas_domain = os.getenv("CANVAS_DOMAIN")
    
    if not api_token or not canvas_domain:
        return False
    
    canvas_api = CanvasAPI(api_token, canvas_domain)
    
    if ai_enabled:
        ai_enhancer = AIEnhancer()
    
    processor = AssignmentProcessor(db, ai_enhancer, reminders_manager)
    return True

def get_due_date(item):
    due_at = item.get("due_at")
    if not due_at and "assignment" in item:
        assignment = item.get("assignment", {})
        if "checkpoints" in assignment and assignment["checkpoints"]:
            due_at = assignment["checkpoints"][0].get("due_at")
    return due_at or ""

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/style.css')
def style_css():
    return send_from_directory('.', 'style.css', mimetype='text/css')

@app.route('/app.js')
def app_js():
    return send_from_directory('.', 'app.js', mimetype='application/javascript')

@app.route('/api/assignments')
def get_assignments():
    try:
        assignments = db.get_all_assignments()
        result = []
        for assignment in assignments:
            result.append({
                'id': assignment[0],
                'assignment_id': assignment[1],
                'title': assignment[2],
                'description': assignment[3],
                'due_at': assignment[4],
                'course_name': assignment[5],
                'reminder_list': assignment[6],
                'ai_notes': assignment[7] if len(assignment) > 7 else None
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/courses')
def get_courses():
    try:
        if not initialize_components():
            return jsonify({'error': 'Canvas API not configured'}), 500
        
        api_token = os.getenv("CANVAS_API_TOKEN")
        canvas_domain = os.getenv("CANVAS_DOMAIN")
        headers = {"Authorization": f"Bearer {api_token}"}
        base_url = f"https://{canvas_domain}/api/v1"
        
        response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
        response.raise_for_status()
        courses = response.json()
        
        result = []
        for course in courses:
            course_name = course.get("name", "Unnamed Course")
            reminder_list, enabled = db.get_course_mapping_with_enabled(course_name)
            if reminder_list is None:
                reminder_list = course_name
                enabled = None
            result.append({
                'id': course.get('id'),
                'name': course_name,
                'reminder_list': reminder_list,
                'enabled': enabled if enabled is not None else True
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sync', methods=['POST'])
def sync_assignments():
    try:
        data = request.json or {}
        ai_enabled = data.get('ai_enabled', False)
        
        if not initialize_components(ai_enabled):
            return jsonify({'error': 'Canvas API not configured'}), 500
        
        college_name = db.get_setting("college_name")
        if not college_name:
            return jsonify({'error': 'College name not set. Please set it in Settings before syncing.'}), 400
        
        now = datetime.now(timezone.utc)
        
        api_token = os.getenv("CANVAS_API_TOKEN")
        canvas_domain = os.getenv("CANVAS_DOMAIN")
        headers = {"Authorization": f"Bearer {api_token}"}
        base_url = f"https://{canvas_domain}/api/v1"
        
        response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
        response.raise_for_status()
        favorite_courses = response.json()
        
        total_added = 0
        added_by_course = {}
        new_assignments_list = []
        
        for course in favorite_courses:
            course_id = course.get("id")
            course_name = course.get("name", "Unnamed Course")
            
            if not course_id:
                continue
            
            reminder_list, enabled = db.get_course_mapping_with_enabled(course_name)
            if enabled == 0:
                continue
            
            if reminder_list is None:
                reminder_list = course_name
            items = canvas_api.get_course_items(course_id)
            
            if not items:
                continue
            
            items.sort(key=get_due_date)
            new_assignments, new_items, new_assignments_data = processor.process_course_assignments(
                reminder_list, items, course_name, college_name, now
            )
            
            if new_assignments > 0:
                added_by_course[course_name] = new_items
                total_added += new_assignments
                new_assignments_list.extend(new_assignments_data)
        
        return jsonify({
            'success': True,
            'total_added': total_added,
            'added_by_course': added_by_course,
            'new_assignments': new_assignments_list
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'GET':
        college_name = db.get_setting("college_name")
        ai_enabled = db.get_setting("ai_enabled")
        return jsonify({
            'college_name': college_name,
            'ai_enabled': ai_enabled == 'true' if ai_enabled else False
        })
    else:
        data = request.json
        college_name = data.get('college_name', '')
        ai_enabled = data.get('ai_enabled', False)
        if college_name:
            db.save_setting("college_name", college_name)
        db.save_setting("ai_enabled", 'true' if ai_enabled else 'false')
        return jsonify({'success': True})

@app.route('/api/course-mapping', methods=['POST'])
def update_course_mapping():
    try:
        data = request.json
        course_name = data.get('course_name')
        reminder_list = data.get('reminder_list')
        
        if course_name and reminder_list:
            db.save_course_mapping(course_name, reminder_list)
            return jsonify({'success': True})
        return jsonify({'error': 'Missing course_name or reminder_list'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/course-mapping/disable', methods=['POST'])
def disable_course_mapping():
    try:
        data = request.json
        course_name = data.get('course_name')
        if not course_name:
            return jsonify({'error': 'Missing course_name'}), 400
        db.delete_course_mapping(course_name)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/course-mapping/enable', methods=['POST'])
def enable_course_mapping():
    try:
        data = request.json
        course_name = data.get('course_name')
        if not course_name:
            return jsonify({'error': 'Missing course_name'}), 400
        db.enable_course_mapping(course_name)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)


#!/usr/bin/env python3

import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

from backend import Database, RemindersManager, CanvasAPI, AssignmentProcessor

def get_reminder_list_name(course_name, db):
    reminder_list = db.get_course_mapping(course_name)
    if reminder_list:
        return reminder_list
    
    print(f"New course found: {course_name}")
    
    while True:
        list_name = input(f"Enter reminder list name for '{course_name}': ").strip()
        print()
        if list_name:
            db.save_course_mapping(course_name, list_name)
            return list_name
        print("Please enter a valid list name.")

def get_due_date(item):
    due_at = item.get("due_at")
    if not due_at and "assignment" in item:
        assignment = item.get("assignment", {})
        if "checkpoints" in assignment and assignment["checkpoints"]:
            due_at = assignment["checkpoints"][0].get("due_at")
    return due_at or ""

def main():
    load_dotenv()
    
    api_token = os.getenv("CANVAS_API_TOKEN")
    canvas_domain = os.getenv("CANVAS_DOMAIN")
    
    if not api_token or not canvas_domain:
        print("ERROR: Missing Canvas API token or domain. Make sure you have a .env file.")
        exit(1)
    
    db = Database(db_path=str(Path(__file__).parent / "studysync-cli.db"))
    
    reminders_manager = RemindersManager()
    canvas_api = CanvasAPI(api_token, canvas_domain)
    processor = AssignmentProcessor(db, reminders_manager)
    
    now = datetime.now(timezone.utc)
    
    favorite_courses = canvas_api.fetch_courses()
    
    course_processing_order = []
    for course in favorite_courses:
        course_name = course.get("name", "Unnamed Course")
        reminder_list = get_reminder_list_name(course_name, db)
        course_processing_order.append((reminder_list, course))
    
    course_processing_order.sort(key=lambda x: x[0])
    
    total_added = 0
    added_by_course = {}
    
    for reminder_list, course in course_processing_order:
        course_id = course.get("id")
        course_name = course.get("name", "Unnamed Course")
        
        if not course_id:
            continue
        
        items = canvas_api.get_course_items(course_id)
        
        if not items:
            print(f"No assignments or discussions found for {reminder_list}")
            continue
        
        items.sort(key=get_due_date)
        
        new_assignments, new_items, _ = processor.process_course_assignments(
            reminder_list, items, course_name, now
        )
        
        if new_assignments > 0:
            added_by_course[course_name] = new_items
            total_added += new_assignments
            print(f"Processing: {reminder_list}")
            print(f"Added {new_assignments} new assignments to {reminder_list}")
            print()
        else:
            print(f"Processing: {reminder_list}")
            print(f"No new assignments for {reminder_list}")
            print()
    
    print("-" * 60)
    print()
    
    if total_added == 0:
        print("No new assignments to add. You're all caught up!")
    else:
        print(f"{total_added} assignments synced:")
        print()
        
        for course, assignments in added_by_course.items():
            print(f"{course}:")
            for title, due in assignments:
                print(f"  - {title} (Due {due})")
            print()

if __name__ == "__main__":
    main()

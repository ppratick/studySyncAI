"""
Command-line interface for StudySync AI.
Provides CLI tool for syncing assignments to Apple Reminders with optional AI summaries.
"""

import os
import sys
import argparse
import requests
from datetime import datetime
from zoneinfo import ZoneInfo
EST = ZoneInfo("America/New_York")
from pathlib import Path
from dotenv import load_dotenv
from backend import Database, AIEnhancer, RemindersManager, CanvasAPI, AssignmentProcessor
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()

def get_due_date(item):
    due_at = item.get("due_at")
    if not due_at and "assignment" in item:
        assignment = item.get("assignment", {})
        if "checkpoints" in assignment and assignment["checkpoints"]:
            due_at = assignment["checkpoints"][0].get("due_at")
    return due_at or ""

def main():
    parser = argparse.ArgumentParser(description='Sync Canvas assignments to Apple Reminders')
    parser.add_argument('-ai', '--ai', action='store_true', help='Enable AI summaries for assignments')
    args = parser.parse_args()

    api_token = os.getenv("CANVAS_API_TOKEN")
    canvas_domain = os.getenv("CANVAS_DOMAIN")

    if not api_token or not canvas_domain:
        print("ERROR: CANVAS_API_TOKEN and CANVAS_DOMAIN must be set in .env file")
        sys.exit(1)

    db_path = str(Path(__file__).parent / "studysync.db")
    db = Database(db_path=db_path)

    ai_enhancer = None
    if args.ai:
        ollama_model = os.getenv("OLLAMA_MODEL")
        if not ollama_model:
            print("ERROR: OLLAMA_MODEL not set in .env file. AI features require this.")
            sys.exit(1)
        try:
            ai_enhancer = AIEnhancer(ollama_model=ollama_model)
            if not ai_enhancer.model:
                print("WARNING: Ollama not available. Continuing without AI summaries.")
                ai_enhancer = None
        except Exception as e:
            print(f"WARNING: Failed to initialize AI: {e}. Continuing without AI summaries.")
            ai_enhancer = None

    reminders_manager = RemindersManager()
    canvas_api = CanvasAPI(api_token, canvas_domain)
    processor = AssignmentProcessor(db, ai_enhancer, reminders_manager)

    college_name = db.get_setting("college_name") or ""

    headers = {"Authorization": f"Bearer {api_token}"}
    base_url = f"https://{canvas_domain}/api/v1"

    try:
        response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
        response.raise_for_status()
        favorite_courses = response.json()
    except Exception as e:
        print(f"ERROR: Failed to fetch courses: {e}")
        sys.exit(1)

    if not favorite_courses:
        print("No favorite courses found. Please favorite courses in Canvas first.")
        sys.exit(0)

    course_mappings = {}
    new_courses = []

    for course in favorite_courses:
        course_name = course.get("name", "Unnamed Course")
        existing_mapping, enabled = db.get_course_mapping_with_enabled(course_name)
        
        if existing_mapping and enabled == 1:
            course_mappings[course.get("id")] = {
                'id': course.get("id"),
                'name': course_name,
                'reminder_list': existing_mapping
            }
        else:
            new_courses.append(course)

    if new_courses:
        print("\nNew courses found:")
        for i, course in enumerate(new_courses, 1):
            course_name = course.get("name", "Unnamed Course")
            print(f"  {i}. {course_name}")

        print("\nEnter reminder list names for new courses (press Enter to skip):")
        for course in new_courses:
            course_name = course.get("name", "Unnamed Course")
            reminder_list = input(f"Reminder list name for '{course_name}': ").strip()
            if reminder_list:
                db.save_course_mapping(course_name, reminder_list)
                course_mappings[course.get("id")] = {
                    'id': course.get("id"),
                    'name': course_name,
                    'reminder_list': reminder_list
                }
            else:
                print(f"  Skipping {course_name}")

    if not course_mappings:
        print("No courses configured with reminder lists")
        sys.exit(0)

    sorted_course_mappings = sorted(course_mappings.items(), key=lambda x: x[1]['reminder_list'])

    print(f"\nSyncing {len(course_mappings)} course(s)...")

    now = datetime.now(EST)
    course_data = {}

    with ThreadPoolExecutor(max_workers=min(5, len(course_mappings))) as executor:
        future_to_course = {
            executor.submit(canvas_api.get_course_items, course_id): course_id
            for course_id in course_mappings.keys()
        }

        for future in as_completed(future_to_course):
            course_id = future_to_course[future]
            course = course_mappings[course_id]
            try:
                items = future.result()
                course_data[course_id] = {
                    'course': course,
                    'items': items
                }
            except Exception as e:
                print(f"Error fetching course {course['name']}: {e}")
                course_data[course_id] = {
                    'course': course,
                    'items': []
                }

    total_added = 0
    for course_id, _ in sorted_course_mappings:
        data = course_data[course_id]
        course = data['course']
        course_name = course['name']
        reminder_list = course['reminder_list']
        items = data['items']

        if not items:
            continue

        items.sort(key=get_due_date)

        course_added = 0
        for item in items:
            should_process, assignment_data = processor.should_process_assignment(item, now)
            if should_process:
                assignment_id = assignment_data['assignment_id']

                if db.is_assignment_permanently_deleted(assignment_id):
                    continue

                existing = db.get_assignment(assignment_id)
                if existing and existing[14] == 1:
                    continue

                processor.process_assignment(assignment_data, reminder_list, course_name, college_name, args.ai)

                assignment = db.get_assignment(assignment_id)
                if assignment:
                    try:
                        due_at = assignment[4]
                        title = assignment[2]
                        ai_notes = assignment[7] if len(assignment) > 7 else ""

                        if ai_notes:
                            lines = ai_notes.split('\n')
                            cleaned_lines = []
                            skip_next = False
                            for i, line in enumerate(lines):
                                if skip_next:
                                    skip_next = False
                                    if line.strip() == '':
                                        continue
                                if line.startswith('Notes:'):
                                    cleaned_lines.append(line.rstrip())
                                    if i + 1 < len(lines) and lines[i + 1].strip() == '':
                                        skip_next = True
                                else:
                                    cleaned_lines.append(line)
                            ai_notes = '\n'.join(cleaned_lines).rstrip()

                        due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=ZoneInfo("UTC"))
                        local_due = due_date_utc.astimezone(EST)
                        apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")

                        reminders_manager.add_reminder(title, apple_due, reminder_list, ai_notes or "")
                        db.mark_reminder_added(assignment_id)
                        course_added += 1
                        print(f"  ✓ Added: {title} (due {local_due.strftime('%m/%d/%Y')})")
                    except Exception as e:
                        print(f"  ✗ Error adding reminder for {title}: {e}")

        if course_added > 0:
            total_added += course_added
            print(f"\n{course_name}: {course_added} assignment(s) added to reminders")

    db.set_last_sync_timestamp(datetime.now(EST).isoformat())

    if total_added > 0:
        print(f"\n✓ Successfully added {total_added} assignment(s) to Apple Reminders")
    else:
        print("\nNo new assignments to add")

if __name__ == '__main__':
    main()


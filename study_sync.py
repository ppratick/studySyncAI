#!/usr/bin/env python3

import os
import requests
import subprocess
import json
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

def run_applescript(script):
    subprocess.run(["osascript", "-e", script])

def add_reminder(title, due_str, list_name, notes=""):
    escaped_notes = notes.replace('"', '\\"')
    script = f'''
    tell application "Reminders"
        set targetList to list "{list_name}"
        set newReminder to make new reminder in targetList
        set name of newReminder to "{title}"
        set due date of newReminder to date "{due_str}"
        set body of newReminder to "{escaped_notes}"
    end tell
    '''
    run_applescript(script)

def remove_existing_reminder(title, list_name):
    script = f'''
    tell application "Reminders"
        set targetList to list "{list_name}"
        set matchingReminders to every reminder in targetList whose name is "{title}"
        repeat with r in matchingReminders
            set completed of r to true
        end repeat
    end tell
    '''
    run_applescript(script)

def main():
    load_dotenv()
    api_token = os.getenv("CANVAS_API_TOKEN")
    canvas_domain = os.getenv("CANVAS_DOMAIN")

    if not api_token or not canvas_domain:
        print("ERROR: Missing Canvas API token or domain. Make sure you have a .env file.")
        exit(1)

    headers = {"Authorization": f"Bearer {api_token}"}
    base_url = f"https://{canvas_domain}/api/v1"
    now = datetime.now(timezone.utc)

    course_to_list = {
        "Introduction to Entrepreneurship": "70-415",
        "Human AI Interaction - 05318/05618": "05-318", 
        "Human Intelligence and Human Stupidity - Monday/Wednesday section": "88-230",
        "Introduction to Accounting": "70-122"
    }

    cache_file = Path("cache/completion.json")
    cache_file.parent.mkdir(parents=True, exist_ok=True)

    completion_cache = set()
    if cache_file.exists():
        try:
            with open(cache_file, "r") as f:
                completion_cache = set(json.load(f))
        except (json.JSONDecodeError, FileNotFoundError):
            completion_cache = set()

    print("Fetching favorite courses from Canvas...")
    
    try:
        response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Failed to fetch favorite courses: {e}")
        exit(1)

    favorite_courses = response.json()
    total_added = 0
    added_by_course = {}

    print(f"Found {len(favorite_courses)} favorite courses")

    for course in favorite_courses:
        course_id = course.get("id")
        course_name = course.get("name", "Unnamed Course")
        reminder_list = course_to_list.get(course_name)

        if not course_id or not reminder_list:
            continue

        print(f"Processing: {course_name}")

        try:
            params = {
                "include[]": ["submission"],
                "per_page": 50
            }
            assignment_response = requests.get(f"{base_url}/courses/{course_id}/assignments", headers=headers, params=params)
            assignment_response.raise_for_status()
        except requests.exceptions.RequestException:
            print(f"WARNING: Skipping {course_name} - API error")
            continue

        assignments = assignment_response.json()
        if not assignments:
            continue

        assignments.sort(key=lambda a: a.get("due_at") or "")

        for assignment in assignments:
            title = assignment.get("name", "No Title")
            due_at = assignment.get("due_at")
            assignment_id = str(assignment.get("id"))

            if assignment_id in completion_cache or not due_at:
                continue

            submission = assignment.get("submission", {})
            if submission.get("submitted_at") is not None:
                continue

            try:
                due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                if due_date_utc <= now:
                    continue

                local_due = due_date_utc.astimezone()
                apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
                display_due = local_due.strftime("%m/%d/%Y")

            except Exception:
                continue

            remove_existing_reminder(title, reminder_list)
            add_reminder(title, apple_due, reminder_list, "")

            completion_cache.add(assignment_id)

            if course_name not in added_by_course:
                added_by_course[course_name] = []
            added_by_course[course_name].append((title, display_due))
            total_added += 1

    try:
        with open(cache_file, "w") as f:
            json.dump(list(completion_cache), f, indent=2)
    except Exception as e:
        print(f"WARNING: Could not save completion cache: {e}")

    print("\nCanvas → Reminders Sync Summary")
    print("-------------------------------------")
    if total_added == 0:
        print("No new assignments to add. You're all caught up!")
    else:
        print(f"{total_added} reminders added:\n")
        for course, assignments in added_by_course.items():
            print(f"{course}:")
            for title, due in assignments:
                print(f"  - {title} (Due {due})")
    print("-------------------------------------\n")

if __name__ == "__main__":
    main()
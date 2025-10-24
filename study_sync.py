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
        try
            set targetList to list "{list_name}"
        on error
            set targetList to make new list with properties {{name:"{list_name}"}}
        end try
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
        try
            set targetList to list "{list_name}"
            set matchingReminders to every reminder in targetList whose name is "{title}"
            repeat with r in matchingReminders
                set completed of r to true
            end repeat
        on error
        end try
    end tell
    '''
    run_applescript(script)

def clear_reminder_list(list_name):
    script = f'''
    tell application "Reminders"
        try
            set targetList to list "{list_name}"
            set allReminders to every reminder in targetList
            repeat with r in allReminders
                delete r
            end repeat
        on error
        end try
    end tell
    '''
    run_applescript(script)

def load_cache(file_path):
    if not file_path.exists():
        return {}
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {}

def save_cache(file_path, data):
    try:
        with open(file_path, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"WARNING: Could not save cache: {e}")

def get_reminder_list_name(course_name, course_mappings, course_mapping_file):
    if course_name in course_mappings:
        return course_mappings[course_name]
    
    print(f"New course found: {course_name}")
    
    while True:
        list_name = input(f"Enter reminder list name for '{course_name}': ").strip()
        print()
        if list_name:
            course_mappings[course_name] = list_name
            save_cache(course_mapping_file, course_mappings)
            return list_name
        print("Please enter a valid list name.")

def fetch_courses(headers, base_url):
    print("Fetching favorite courses from Canvas")
    try:
        response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
        response.raise_for_status()
        courses = response.json()
        print(f"Found {len(courses)} favorite courses")
        print()
        print("-" * 60)
        print()
        return courses
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Failed to fetch favorite courses: {e}")
        exit(1)

def should_process_assignment(item, assignment_cache, now):
    title = item.get("name") or item.get("title", "No Title")
    assignment_id = str(item.get("id"))
    
    due_at = item.get("due_at")
    
    if not due_at and "assignment" in item:
        assignment = item.get("assignment", {})
        if "checkpoints" in assignment and assignment["checkpoints"]:
            due_at = assignment["checkpoints"][0].get("due_at")
    
    if not due_at:
        return False, None
    
    if "submission" in item:
        submission = item.get("submission", {})
        if submission.get("submitted_at") is not None:
            return False, None
    
    try:
        due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if due_date_utc <= now:
            return False, None
        
        local_due = due_date_utc.astimezone()
        apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
        display_due = local_due.strftime("%m/%d/%Y")
        
    except Exception:
        return False, None
    
    cached_due = assignment_cache.get(assignment_id)
    if cached_due == due_at:
        return False, None
    
    return True, {
        "title": title,
        "assignment_id": assignment_id,
        "due_at": due_at,
        "apple_due": apple_due,
        "display_due": display_due
    }

def process_assignment(assignment_data, reminder_list, assignment_cache):
    if not assignment_data:
        return
    
    title = assignment_data["title"]
    assignment_id = assignment_data["assignment_id"]
    due_at = assignment_data["due_at"]
    apple_due = assignment_data["apple_due"]
    
    cached_due = assignment_cache.get(assignment_id)
    if cached_due and cached_due != due_at:
        remove_existing_reminder(title, reminder_list)
    
    add_reminder(title, apple_due, reminder_list, "")
    assignment_cache[assignment_id] = due_at

def process_course(course, headers, base_url, get_reminder_list_name):
    course_id = course.get("id")
    course_name = course.get("name", "Unnamed Course")
    
    if not course_id:
        return []
    
    reminder_list = get_reminder_list_name(course_name)
    
    all_items = []
    
    try:
        params = {"include[]": ["submission"], "per_page": 50}
        response = requests.get(f"{base_url}/courses/{course_id}/assignments", headers=headers, params=params)
        response.raise_for_status()
        assignments = response.json()
        all_items.extend(assignments)
    except requests.exceptions.RequestException:
        print(f"WARNING: Failed to fetch assignments for {reminder_list}")
    
    try:
        params = {"per_page": 50}
        response = requests.get(f"{base_url}/courses/{course_id}/discussion_topics", headers=headers, params=params)
        response.raise_for_status()
        discussions = response.json()
        all_items.extend(discussions)
    except requests.exceptions.RequestException:
        print(f"WARNING: Failed to fetch discussions for {reminder_list}")
    
    if not all_items:
        print(f"No assignments or discussions found for {reminder_list}")
        return []
    
    def get_due_date(item):
        due_at = item.get("due_at")
        if not due_at and "assignment" in item:
            assignment = item.get("assignment", {})
            if "checkpoints" in assignment and assignment["checkpoints"]:
                due_at = assignment["checkpoints"][0].get("due_at")
        return due_at or ""
    
    all_items.sort(key=get_due_date)
    return all_items, course_name, reminder_list

def sort_reminders_by_due_date(list_name):
    script = f'''
    tell application "Reminders"
        set targetList to list "{list_name}"
        set allReminders to every reminder in targetList
        
        set reminderData to {{}}
        repeat with r in allReminders
            set reminderName to name of r
            set reminderDue to due date of r
            set end of reminderData to {{reminderName, reminderDue, r}}
        end repeat
        
        set sortedData to my sortByDueDate(reminderData)
        
        repeat with r in allReminders
            delete r
        end repeat
        repeat with reminderItem in sortedData
            set reminderName to item 1 of reminderItem
            set reminderDue to item 2 of reminderItem
            set newReminder to make new reminder in targetList
            set name of newReminder to reminderName
            set due date of newReminder to reminderDue
        end repeat
    end tell
    
    on sortByDueDate(dataList)
        set listLength to count of dataList
        repeat with i from 1 to (listLength - 1)
            repeat with j from 1 to (listLength - i)
                set reminderItem1 to item j of dataList
                set reminderItem2 to item (j + 1) of dataList
                set due1 to item 2 of reminderItem1
                set due2 to item 2 of reminderItem2
                
                if due1 > due2 then
                    set item j of dataList to reminderItem2
                    set item (j + 1) of dataList to reminderItem1
                end if
            end repeat
        end repeat
        
        return dataList
    end sortByDueDate
    '''
    run_applescript(script)

def process_course_assignments(reminder_list, items, assignment_cache, now):
    new_assignments = 0
    new_items = []
    
    for item in items:
        should_process, assignment_data = should_process_assignment(item, assignment_cache, now)
        if should_process:
            new_assignments += 1
            new_items.append((assignment_data["title"], assignment_data["display_due"]))
            process_assignment(assignment_data, reminder_list, assignment_cache)
    
    return new_assignments, new_items

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
    
    cache_file = Path("cache/completion.json")
    course_mapping_file = Path("cache/course_mappings.json")
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    
    assignment_cache = load_cache(cache_file)
    course_mappings = load_cache(course_mapping_file)
    
    get_reminder_list_name_func = lambda course_name: get_reminder_list_name(course_name, course_mappings, course_mapping_file)
    
    favorite_courses = fetch_courses(headers, base_url)
    
    course_processing_order = []
    for course in favorite_courses:
        course_name = course.get("name", "Unnamed Course")
        reminder_list = get_reminder_list_name_func(course_name)
        course_processing_order.append((reminder_list, course))
    
    course_processing_order.sort(key=lambda x: x[0])
    
    print("-" * 60)
    print()
    
    total_added = 0
    added_by_course = {}
    
    for reminder_list, course in course_processing_order:
        result = process_course(course, headers, base_url, get_reminder_list_name_func)
        if not result:
            continue
        
        items, course_name, reminder_list = result
        new_assignments, new_items = process_course_assignments(reminder_list, items, assignment_cache, now)
        
        if new_assignments > 0:
            added_by_course[course_name] = new_items
            total_added += new_assignments
            print(f"Processing: {reminder_list}")
            print(f"Added {new_assignments} new assignments to {reminder_list}")
            print()
        else:
            print(f"Processing: {reminder_list}")
            print(f"No new assignments for {reminder_list}")
    
    save_cache(cache_file, assignment_cache)
    
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
#!/usr/bin/env python3

import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from backend.database import Database
from backend.ai_enhancer import AIEnhancer
from backend.reminders_manager import RemindersManager
from backend.canvas_api import CanvasAPI
from backend.assignment_processor import AssignmentProcessor

def get_college_name(db):
    college_name = db.get_setting("college_name")
    if college_name:
        return college_name
    
    print("What college/university do you attend?")
    college_name = input("College: ").strip()
    print()
    
    if college_name:
        db.save_setting("college_name", college_name)
    
    return college_name

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
    
    db = Database()
    ai_enhancer = AIEnhancer()
    reminders_manager = RemindersManager()
    canvas_api = CanvasAPI(api_token, canvas_domain)
    processor = AssignmentProcessor(db, ai_enhancer, reminders_manager)
    
    if ai_enhancer.model:
        print("AI enhancement enabled with Gemini")
    else:
        print("AI enhancement disabled")
    
    college_name = get_college_name(db)
    
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
        
        new_assignments, new_items = processor.process_course_assignments(
            reminder_list, items, course_name, college_name, now
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
    
    print("=" * 60)
    print("📚 STUDY PLAN")
    print("=" * 60)
    print()
    
    study_plan = generate_study_plan(db, canvas_api, college_name, ai_enhancer)
    for line in study_plan:
        print(line)

def generate_study_plan(db, canvas_api, college_name, ai_enhancer):
    plan = []
    
    all_assignments = db.get_all_assignments()
    if not all_assignments:
        return ["No assignments found. Run the sync first!"]
    
    from datetime import datetime, timedelta
    now = datetime.now()
    
    plan.append("🎯 UPCOMING DEADLINES:")
    plan.append("")
    
    urgent = []
    this_week = []
    next_week = []
    later = []
    
    for assignment in all_assignments:
        try:
            due_date = datetime.strptime(assignment[3], "%Y-%m-%dT%H:%M:%SZ")
            days_until = (due_date - now).days
            
            if days_until <= 2:
                urgent.append((assignment[1], due_date.strftime("%m/%d"), days_until))
            elif days_until <= 7:
                this_week.append((assignment[1], due_date.strftime("%m/%d"), days_until))
            elif days_until <= 14:
                next_week.append((assignment[1], due_date.strftime("%m/%d"), days_until))
            else:
                later.append((assignment[1], due_date.strftime("%m/%d"), days_until))
        except:
            continue
    
    if urgent:
        plan.append("🚨 URGENT (Due in 2 days or less):")
        for title, due, days in sorted(urgent, key=lambda x: x[2]):
            plan.append(f"  • {title} - Due {due} ({days} days)")
        plan.append("")
    
    if this_week:
        plan.append("📅 THIS WEEK:")
        for title, due, days in sorted(this_week, key=lambda x: x[2]):
            plan.append(f"  • {title} - Due {due} ({days} days)")
        plan.append("")
    
    if next_week:
        plan.append("📆 NEXT WEEK:")
        for title, due, days in sorted(next_week, key=lambda x: x[2]):
            plan.append(f"  • {title} - Due {due} ({days} days)")
        plan.append("")
    
    if later:
        plan.append("📚 UPCOMING:")
        for title, due, days in sorted(later, key=lambda x: x[2]):
            plan.append(f"  • {title} - Due {due} ({days} days)")
        plan.append("")
    
    ai_study_tips = generate_ai_study_tips(all_assignments, college_name, ai_enhancer)
    plan.extend(ai_study_tips)
    plan.append("")
    
    return plan

def generate_ai_study_tips(assignments, college_name, ai_enhancer):
    if not ai_enhancer.model or not assignments:
        return [
            "💡 STUDY TIPS:",
            "  • Start with urgent assignments first",
            "  • Block 2-3 hour study sessions", 
            "  • Take breaks every 45 minutes",
            "  • Review AI notes for each assignment"
        ]
    
    try:
        from datetime import datetime
        
        urgent_count = 0
        this_week_count = 0
        total_assignments = len(assignments)
        
        now = datetime.now()
        for assignment in assignments:
            try:
                due_date = datetime.strptime(assignment[3], "%Y-%m-%dT%H:%M:%SZ")
                days_until = (due_date - now).days
                
                if days_until <= 2:
                    urgent_count += 1
                elif days_until <= 7:
                    this_week_count += 1
            except:
                continue
        
        prompt = f"""College: {college_name}
Total assignments: {total_assignments}
Urgent assignments (≤2 days): {urgent_count}
This week assignments (3-7 days): {this_week_count}

Generate personalized study strategy tips for this workload. Be concise and practical.

Format:
💡 STUDY STRATEGY:
• [specific tip 1]
• [specific tip 2]
• [specific tip 3]
• [specific tip 4]"""
        
        response = ai_enhancer.model.generate_content(prompt)
        tips = response.text.strip().split('\n')
        
        return tips if tips else [
            "💡 STUDY STRATEGY:",
            "  • Prioritize urgent assignments",
            "  • Schedule focused study blocks",
            "  • Take regular breaks",
            "  • Review AI notes for guidance"
        ]
        
    except Exception as e:
        print(f"WARNING: AI study tips failed: {e}")
        return [
            "💡 STUDY STRATEGY:",
            "  • Start with urgent assignments first",
            "  • Block 2-3 hour study sessions",
            "  • Take breaks every 45 minutes", 
            "  • Review AI notes for each assignment"
        ]

if __name__ == "__main__":
    main()

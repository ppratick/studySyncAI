#!/usr/bin/env python3

from datetime import datetime, timezone
from .database import Database
from .ai_enhancer import AIEnhancer
from .reminders_manager import RemindersManager

class AssignmentProcessor:
    def __init__(self, db, ai_enhancer, reminders_manager):
        self.db = db
        self.ai_enhancer = ai_enhancer
        self.reminders_manager = reminders_manager
    
    def should_process_assignment(self, item, now):
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
        
        existing = self.db.get_assignment(assignment_id)
        if existing and existing[4] == due_at:
            return False, None
        
        return True, {
            "title": title,
            "assignment_id": assignment_id,
            "due_at": due_at,
            "apple_due": apple_due,
            "display_due": display_due,
            "description": item.get("description", "")
        }
    
    def process_assignment(self, assignment_data, reminder_list, course_name, college_name):
        if not assignment_data:
            return
        
        title = assignment_data["title"]
        assignment_id = assignment_data["assignment_id"]
        due_at = assignment_data["due_at"]
        apple_due = assignment_data["apple_due"]
        description = assignment_data.get("description", "")
        
        existing = self.db.get_assignment(assignment_id)
        if existing and existing[4] != due_at:
            self.reminders_manager.remove_existing_reminder(title, reminder_list)
        
        ai_notes = ""
        if self.ai_enhancer and self.ai_enhancer.model:
            if existing and existing[6] and existing[6].strip():
                ai_notes = existing[6]
            else:
                ai_notes = self.ai_enhancer.enhance_assignment(title, description, course_name, college_name)
        
        self.reminders_manager.add_reminder(title, apple_due, reminder_list, ai_notes)
        self.db.save_assignment(assignment_id, title, description, due_at, course_name, reminder_list, ai_notes)
    
    def process_course_assignments(self, reminder_list, items, course_name, college_name, now):
        new_assignments = 0
        new_items = []
        
        for item in items:
            should_process, assignment_data = self.should_process_assignment(item, now)
            if should_process:
                new_assignments += 1
                new_items.append((assignment_data["title"], assignment_data["display_due"]))
                self.process_assignment(assignment_data, reminder_list, course_name, college_name)
        
        return new_assignments, new_items

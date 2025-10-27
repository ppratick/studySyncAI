#!/usr/bin/env python3

import subprocess

class RemindersManager:
    @staticmethod
    def run_applescript(script):
        subprocess.run(["osascript", "-e", script])
    
    @staticmethod
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
        RemindersManager.run_applescript(script)
    
    @staticmethod
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
        RemindersManager.run_applescript(script)
    
    @staticmethod
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
        RemindersManager.run_applescript(script)

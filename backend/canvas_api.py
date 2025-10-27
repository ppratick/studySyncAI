#!/usr/bin/env python3

import requests
from datetime import datetime, timezone

class CanvasAPI:
    def __init__(self, api_token, canvas_domain):
        self.headers = {"Authorization": f"Bearer {api_token}"}
        self.base_url = f"https://{canvas_domain}/api/v1"
    
    def fetch_courses(self):
        print("Fetching favorite courses from Canvas")
        try:
            response = requests.get(f"{self.base_url}/users/self/favorites/courses", headers=self.headers)
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
    
    def fetch_course_assignments(self, course_id):
        try:
            params = {"include[]": ["submission", "description"], "per_page": 50}
            response = requests.get(f"{self.base_url}/courses/{course_id}/assignments", headers=self.headers, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException:
            return []
    
    def fetch_course_discussions(self, course_id):
        try:
            params = {"per_page": 50}
            response = requests.get(f"{self.base_url}/courses/{course_id}/discussion_topics", headers=self.headers, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException:
            return []
    
    def get_course_items(self, course_id):
        assignments = self.fetch_course_assignments(course_id)
        discussions = self.fetch_course_discussions(course_id)
        return assignments + discussions

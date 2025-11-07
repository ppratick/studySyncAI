let assignments = [];
let courses = [];
let collegeName = null;
let aiEnabled = false;

document.addEventListener('DOMContentLoaded', () => {
    loadCourses();
    loadSettings();
    displayAssignments([]);
    
    document.getElementById('syncBtn').addEventListener('click', syncAssignments);
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('searchInput').addEventListener('input', filterAssignments);
    document.getElementById('courseFilter').addEventListener('change', filterAssignments);
    
    document.getElementById('collegeName').addEventListener('change', (e) => {
        const customInput = document.getElementById('collegeNameCustom');
        if (e.target.value === 'Other') {
            customInput.style.display = 'block';
            customInput.focus();
        } else {
            customInput.style.display = 'none';
            customInput.value = '';
        }
    });
    
    const modal = document.getElementById('settingsModal');
    document.querySelector('.close').addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});


async function loadCourses() {
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        courses = data;
        
        const filter = document.getElementById('courseFilter');
        filter.innerHTML = '<option value="">All Courses</option>';
        courses.forEach(course => {
            const option = document.createElement('option');
            option.value = course.name;
            option.textContent = course.name;
            filter.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading courses:', error);
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        if (data.college_name) {
            collegeName = data.college_name;
            const select = document.getElementById('collegeName');
            const customInput = document.getElementById('collegeNameCustom');
            
            const option = Array.from(select.options).find(opt => opt.value === data.college_name);
            if (option) {
                select.value = data.college_name;
                customInput.style.display = 'none';
            } else {
                select.value = 'Other';
                customInput.value = data.college_name;
                customInput.style.display = 'block';
            }
        } else {
            showStatus('Please set your college name in Settings before syncing.', 'warning');
        }
        if (data.ai_enabled !== undefined) {
            aiEnabled = data.ai_enabled;
            document.getElementById('aiEnabled').checked = data.ai_enabled;
        }
        await loadCoursesInSettings();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function loadCoursesInSettings() {
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        
        const coursesList = document.getElementById('coursesList');
        if (data.error || !data || data.length === 0) {
            coursesList.innerHTML = '<p style="color: #666; font-style: italic;">No courses synced yet. Favorite courses on Canvas and click "Sync Assignments" to add them.</p>';
            return;
        }
        
        coursesList.innerHTML = '';
        data.forEach(course => {
            const courseItem = document.createElement('div');
            const isEnabled = course.enabled === true || course.enabled === 1 || course.enabled === '1';
            courseItem.className = `course-item ${!isEnabled ? 'course-disabled' : ''}`;
            const reminderListDisplay = (course.reminder_list && course.reminder_list.trim() !== course.name.trim()) 
                ? `<span class="reminder-list-name">→ ${course.reminder_list}</span>` 
                : '';
            
            const actionButton = document.createElement('button');
            actionButton.className = isEnabled ? 'btn-delete' : 'btn-enable';
            actionButton.textContent = isEnabled ? '×' : '✓';
            actionButton.title = isEnabled ? 'Disable course' : 'Enable course';
            actionButton.dataset.courseName = course.name;
            actionButton.addEventListener('click', () => {
                if (isEnabled) {
                    deleteCourse(course.name);
                } else {
                    enableCourse(course.name);
                }
            });
            
            const courseInfo = document.createElement('div');
            courseInfo.className = 'course-info';
            courseInfo.innerHTML = `
                <strong>${course.name}</strong>
                ${reminderListDisplay}
                ${!isEnabled ? '<span class="disabled-label">(Disabled)</span>' : ''}
            `;
            
            courseItem.appendChild(courseInfo);
            courseItem.appendChild(actionButton);
            coursesList.appendChild(courseItem);
        });
    } catch (error) {
        console.error('Error loading courses:', error);
        document.getElementById('coursesList').innerHTML = '<p style="color: #d32f2f;">Error loading courses</p>';
    }
}

async function deleteCourse(courseName) {
    try {
        const response = await fetch('/api/course-mapping/disable', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ course_name: courseName })
        });
        
        const data = await response.json();
        if (data.success) {
            showStatus('Course disabled successfully', 'success');
            await loadCoursesInSettings();
            await loadCourses();
        } else {
            showStatus('Error disabling course: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error disabling course: ' + error.message, 'error');
    }
}

async function enableCourse(courseName) {
    try {
        const response = await fetch('/api/course-mapping/enable', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ course_name: courseName })
        });
        
        const data = await response.json();
        if (data.success) {
            showStatus('Course enabled successfully', 'success');
            await loadCoursesInSettings();
            await loadCourses();
        } else {
            showStatus('Error enabling course: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error enabling course: ' + error.message, 'error');
    }
}

async function syncAssignments() {
    if (!collegeName) {
        showStatus('Please set your college name in Settings before syncing.', 'error');
        return;
    }
    const btn = document.getElementById('syncBtn');
    
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    showStatus('Syncing assignments from Canvas...', 'info');
    
    try {
        const response = await fetch('/api/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ai_enabled: aiEnabled })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showStatus('Error: ' + data.error, 'error');
        } else {
            if (data.total_added > 0) {
                assignments = data.new_assignments || [];
                displayAssignments(assignments);
                updateStats();
                showStatus(`Successfully synced ${data.total_added} new assignments!`, 'success');
            } else {
                assignments = [];
                displayAssignments([]);
                updateStats();
                showStatus('No new assignments to add. You\'re all caught up!', 'info');
            }
            await loadCourses();
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal.style.display === 'block') {
                await loadCoursesInSettings();
            }
        }
    } catch (error) {
        showStatus('Error syncing: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Assignments';
    }
}

async function saveSettings() {
    const select = document.getElementById('collegeName');
    const customInput = document.getElementById('collegeNameCustom');
    const newCollegeName = select.value === 'Other' ? customInput.value.trim() : select.value;
    const newAiEnabled = document.getElementById('aiEnabled').checked;
    
    if (!newCollegeName) {
        showStatus('Please select or enter your college name.', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                college_name: newCollegeName,
                ai_enabled: newAiEnabled
            })
        });
        
        const data = await response.json();
               if (data.success) {
                   collegeName = newCollegeName;
                   aiEnabled = newAiEnabled;
                   showStatus('Settings saved!', 'success');
                   await loadCoursesInSettings();
                   document.getElementById('settingsModal').style.display = 'none';
                   const status = document.getElementById('status');
                   if (status.className.includes('warning')) {
                       status.style.display = 'none';
                   }
               }
    } catch (error) {
        showStatus('Error saving settings: ' + error.message, 'error');
    }
}

function openSettings() {
    document.getElementById('settingsModal').style.display = 'block';
}

function displayAssignments(assignmentsToShow) {
    const list = document.getElementById('assignmentsList');
    
    if (assignmentsToShow.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No new assignments. Click "Sync Assignments" to check for new assignments from Canvas!</p>';
        return;
    }
    
    const sortedAssignments = [...assignmentsToShow].sort((a, b) => {
        const dateA = new Date(a.due_at);
        const dateB = new Date(b.due_at);
        return dateA - dateB;
    });
    
    list.innerHTML = sortedAssignments.map(assignment => {
        const dueDate = new Date(assignment.due_at);
        const formattedDate = dueDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        
        const aiNotesSection = assignment.ai_notes ? 
            `<div class="assignment-ai-notes"><strong>AI Notes:</strong><br>${assignment.ai_notes}</div>` : '';
        
        return `
            <div class="assignment-card">
                <div class="assignment-header">
                    <div class="assignment-title">${escapeHtml(assignment.title)}</div>
                    <div class="assignment-due">Due: ${formattedDate}</div>
                </div>
                <div class="assignment-course">${escapeHtml(assignment.course_name)}</div>
                ${aiNotesSection}
            </div>
        `;
    }).join('');
}

function filterAssignments() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const courseFilter = document.getElementById('courseFilter').value;
    
    let filtered = assignments;
    
    if (courseFilter) {
        filtered = filtered.filter(a => a.course_name === courseFilter);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(a => 
            a.title.toLowerCase().includes(searchTerm) ||
            a.course_name.toLowerCase().includes(searchTerm)
        );
    }
    
    displayAssignments(filtered);
}

function updateStats() {
    const total = assignments.length;
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const upcoming = assignments.filter(a => {
        const dueDate = new Date(a.due_at);
        return dueDate >= now && dueDate <= weekFromNow;
    }).length;
    
    document.getElementById('totalAssignments').textContent = total;
    document.getElementById('upcomingAssignments').textContent = upcoming;
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 5000);
    } else if (type === 'info') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 5000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


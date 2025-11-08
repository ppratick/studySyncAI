let assignments = [];
let courses = [];
let collegeName = null;
let pendingReminderAssignmentId = null; // Track assignment ID when setup modal is shown from "Add to Reminders"
let courseEnableDisableChanges = {}; // Track enable/disable changes in settings modal (courseName -> enabled state)
let originalCourseStates = {}; // Store original enabled states when modal opens (courseName -> enabled state)

document.addEventListener('DOMContentLoaded', () => {
    loadCourses();
    loadSettings();
    loadAssignments();
    
    // Initialize reminder button event delegation
    attachReminderListeners();
    
    document.getElementById('syncBtn').addEventListener('click', syncAssignments);
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('searchInput').addEventListener('input', filterAssignments);
    document.getElementById('courseFilter').addEventListener('change', filterAssignments);
    document.getElementById('saveAndSync').addEventListener('click', saveAndSync);
    document.getElementById('cancelSetup').addEventListener('click', closeSetupModal);
    
    // Setup modal auto-sync toggle (reminder lists are always shown now, but this can still be used for other logic)
    const setupAutoSyncCheckbox = document.getElementById('setupAutoSyncReminders');
    if (setupAutoSyncCheckbox) {
        setupAutoSyncCheckbox.addEventListener('change', async (e) => {
            // Reminder lists are always required now, so we don't hide/show the section
            // But we can still load courses if needed
            const reminderListsGroup = document.getElementById('setupReminderListsGroup');
            if (reminderListsGroup && reminderListsGroup.children.length === 0) {
                await loadSetupCourses();
            }
        });
    }
    
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
    const closeBtn = document.querySelector('.close');
    
    closeBtn.addEventListener('click', () => {
        closeModal();
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
        const setupModal = document.getElementById('setupModal');
        if (e.target === setupModal) {
            closeSetupModal();
        }
    });
});


async function loadAssignments() {
    try {
        const response = await fetch('/api/assignments');
        const data = await response.json();
        if (data.error) {
            console.error('Error loading assignments:', data.error);
            assignments = [];
        } else {
            assignments = data;
            displayAssignments(assignments);
            updateStats();
            attachReminderListeners();
        }
    } catch (error) {
        console.error('Error loading assignments:', error);
        assignments = [];
        displayAssignments([]);
    }
}

async function loadCourses() {
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        
        if (data.error) {
            console.error('Error loading courses:', data.error);
            courses = [];
            return;
        }
        
        if (!Array.isArray(data)) {
            console.error('Invalid courses data format:', data);
            courses = [];
            return;
        }
        
        courses = data;
        
        const filter = document.getElementById('courseFilter');
        filter.innerHTML = '<option value="">All Courses</option>';
        courses.forEach(course => {
            if (!course || !course.name) {
                console.warn('Invalid course data:', course);
                return;
            }
            const option = document.createElement('option');
            option.value = course.name;
            option.textContent = course.name;
            filter.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading courses:', error);
        courses = [];
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
        }
        
        // Set auto-sync toggle
        const autoSyncCheckbox = document.getElementById('settingsAutoSyncReminders');
        if (autoSyncCheckbox) {
            const autoSyncEnabled = data.auto_sync_reminders === '1' || data.auto_sync_reminders === true;
            autoSyncCheckbox.checked = autoSyncEnabled;
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
        
        if (data.error) {
            coursesList.innerHTML = '<p style="color: #d32f2f;">Error loading courses: ' + escapeHtml(String(data.error)) + '</p>';
            return;
        }
        
        if (!Array.isArray(data) || data.length === 0) {
            coursesList.innerHTML = '<p style="color: #666; font-style: italic;">No courses synced yet. Favorite courses on Canvas and click "Sync Assignments" to add them.</p>';
            return;
        }
        
        coursesList.innerHTML = '';
        data.forEach(course => {
            if (!course || !course.name) {
                console.warn('Invalid course data:', course);
                return;
            }
            
            const courseItem = document.createElement('div');
            const isEnabled = course.enabled === true || course.enabled === 1 || course.enabled === '1';
            const courseName = String(course.name || '');
            
            // Store original state
            originalCourseStates[courseName] = isEnabled;
            
            // Check if there's a pending change for this course
            const currentState = courseEnableDisableChanges.hasOwnProperty(courseName) 
                ? courseEnableDisableChanges[courseName] 
                : isEnabled;
            
            courseItem.className = `course-item ${!currentState ? 'course-disabled' : ''}`;
            
            const reminderList = course.reminder_list ? String(course.reminder_list).trim() : '';
            const reminderListDisplay = (reminderList && reminderList !== courseName.trim()) 
                ? `<span class="reminder-list-name">→ ${escapeHtml(reminderList)}</span>` 
                : '';
            
            const actionButton = document.createElement('button');
            actionButton.className = currentState ? 'btn-delete' : 'btn-enable';
            actionButton.textContent = currentState ? '×' : '✓';
            actionButton.title = currentState ? 'Disable course' : 'Enable course';
            actionButton.dataset.courseName = courseName;
            actionButton.addEventListener('click', () => {
                toggleCourseEnabled(courseName, courseItem, actionButton);
            });
            
            const courseInfo = document.createElement('div');
            courseInfo.className = 'course-info';
            
            const reminderListSpan = document.createElement('span');
            reminderListSpan.className = 'reminder-list-editable';
            // Show "Click to set" if reminder list is empty or equals course name (default)
            const hasValidReminderList = reminderList && reminderList.trim() !== '' && reminderList.trim() !== courseName.trim();
            reminderListSpan.textContent = hasValidReminderList ? reminderList : 'Click to set';
            reminderListSpan.dataset.courseName = courseName;
            reminderListSpan.dataset.reminderList = reminderList || '';
            reminderListSpan.title = hasValidReminderList ? 'Click to edit reminder list name' : 'Click to set reminder list name (required)';
            reminderListSpan.style.cursor = 'pointer';
            reminderListSpan.style.color = hasValidReminderList ? '#667eea' : '#d32f2f';
            reminderListSpan.style.textDecoration = 'underline';
            reminderListSpan.style.textDecorationStyle = 'dotted';
            reminderListSpan.style.fontWeight = hasValidReminderList ? 'normal' : '600';
            
            reminderListSpan.addEventListener('click', () => {
                // Don't autofill if reminder list is empty or equals course name
                const reminderListToEdit = (reminderList && reminderList.trim() !== '' && reminderList.trim() !== courseName.trim()) 
                    ? reminderList 
                    : '';
                editReminderList(courseName, reminderListToEdit);
            });
            
            courseInfo.innerHTML = `
                <strong>${escapeHtml(courseName)}</strong>
                <div style="margin-top: 4px; font-size: 0.85em;">
                    <span style="color: #666;">Reminder List: </span>
                </div>
            `;
            courseInfo.querySelector('div').appendChild(reminderListSpan);
            // Show disabled label based on current state (including pending changes)
            if (!currentState) {
                const disabledLabel = document.createElement('span');
                disabledLabel.className = 'disabled-label';
                disabledLabel.textContent = '(Disabled)';
                courseInfo.appendChild(disabledLabel);
            }
            // Update course item class based on current state
            courseItem.className = `course-item ${!currentState ? 'course-disabled' : ''}`;
            
            courseItem.appendChild(courseInfo);
            courseItem.appendChild(actionButton);
            coursesList.appendChild(courseItem);
        });
    } catch (error) {
        console.error('Error loading courses:', error);
        document.getElementById('coursesList').innerHTML = '<p style="color: #d32f2f;">Error loading courses</p>';
    }
}

// Toggle course enabled state locally (only saves when "Save" is clicked)
function toggleCourseEnabled(courseName, courseItem, actionButton) {
    // Get current state (from pending changes or original state)
    const currentState = courseEnableDisableChanges.hasOwnProperty(courseName) 
        ? courseEnableDisableChanges[courseName] 
        : (originalCourseStates[courseName] !== undefined ? originalCourseStates[courseName] : true);
    
    // Toggle the state
    const newState = !currentState;
    courseEnableDisableChanges[courseName] = newState;
    
    // Update UI
    actionButton.className = newState ? 'btn-delete' : 'btn-enable';
    actionButton.textContent = newState ? '×' : '✓';
    actionButton.title = newState ? 'Disable course' : 'Enable course';
    courseItem.className = `course-item ${!newState ? 'course-disabled' : ''}`;
    
    // Update disabled label
    const courseInfo = courseItem.querySelector('.course-info');
    let disabledLabel = courseInfo.querySelector('.disabled-label');
    if (!newState && !disabledLabel) {
        disabledLabel = document.createElement('span');
        disabledLabel.className = 'disabled-label';
        disabledLabel.textContent = '(Disabled)';
        courseInfo.appendChild(disabledLabel);
    } else if (newState && disabledLabel) {
        disabledLabel.remove();
    }
}

// Old functions kept for backward compatibility but not used in settings
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
    // Check if setup is needed
    const needsSetup = await checkSetupRequired();
    if (needsSetup) {
        showSetupModal();
        return;
    }
    
    await performSync();
}

async function checkSetupRequired() {
    // Check college name
    if (!collegeName) {
        return true;
    }
    
    // Always check if any course (enabled or disabled) is missing reminder list name
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        
        if (data.error || !Array.isArray(data)) {
            return false; // Can't check, proceed anyway
        }
        
        // Check ALL courses (enabled and disabled) for missing or default reminder list names
        const coursesNeedingSetup = data.filter(course => {
            if (!course || !course.name) return false;
            const reminderList = course.reminder_list ? course.reminder_list.trim() : '';
            const hasReminderList = reminderList !== '';
            const isDefaultName = reminderList === course.name;
            // Need setup if no reminder list OR if it's set to the default (course name)
            return !hasReminderList || isDefaultName;
        });
        
        return coursesNeedingSetup.length > 0;
    } catch (error) {
        console.error('Error checking setup:', error);
        return false;
    }
}

function showSetupModal(showReminderListsMessage = false, assignmentIdForReminder = null, warningMessage = null) {
    const modal = document.getElementById('setupModal');
    const collegeSelect = document.getElementById('setupCollegeName');
    const collegeCustom = document.getElementById('setupCollegeNameCustom');
    const autoSyncCheckbox = document.getElementById('setupAutoSyncReminders');
    const reminderListsGroup = document.getElementById('setupReminderListsGroup');
    const saveButton = document.getElementById('saveAndSync');
    const warningDiv = document.getElementById('setupWarningMessage');
    
    // Show/hide warning message
    if (warningMessage) {
        warningDiv.textContent = warningMessage;
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }
    
    // Store assignment ID if this is for adding a reminder
    pendingReminderAssignmentId = assignmentIdForReminder || null;
    
    // Change button text based on context
    if (assignmentIdForReminder) {
        saveButton.textContent = 'Save & Add Reminder';
    } else {
        saveButton.textContent = 'Save & Sync';
    }
    
    // Set current college name if exists
    if (collegeName) {
        const option = Array.from(collegeSelect.options).find(opt => opt.value === collegeName);
        if (option) {
            collegeSelect.value = collegeName;
            collegeCustom.style.display = 'none';
        } else {
            collegeSelect.value = 'Other';
            collegeCustom.value = collegeName;
            collegeCustom.style.display = 'block';
        }
    } else {
        collegeSelect.value = '';
        collegeCustom.style.display = 'none';
        collegeCustom.value = '';
    }
    
    // Load current auto-sync setting
    fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
            const autoSyncEnabled = data.auto_sync_reminders === '1' || data.auto_sync_reminders === true;
            autoSyncCheckbox.checked = autoSyncEnabled;
            // Reminder lists are always shown now
            reminderListsGroup.style.display = 'block';
            
            // Always load courses for reminder list setup
            loadSetupCourses();
        })
        .catch(err => {
            console.error('Error loading settings:', err);
            autoSyncCheckbox.checked = false;
            reminderListsGroup.style.display = 'block'; // Always show reminder lists
            loadSetupCourses();
        });
    
    // Handle "Other" option - use event delegation to avoid duplicate listeners
    collegeSelect.onchange = (e) => {
        if (e.target.value === 'Other') {
            collegeCustom.style.display = 'block';
            collegeCustom.focus();
        } else {
            collegeCustom.style.display = 'none';
            collegeCustom.value = '';
        }
    };
    
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

async function loadSetupCourses() {
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        const coursesList = document.getElementById('setupCoursesList');
        
        if (data.error || !Array.isArray(data) || data.length === 0) {
            coursesList.innerHTML = '<p style="color: #666; font-style: italic;">No courses found.</p>';
            return;
        }
        
        // Show ALL courses (enabled and disabled) so users can set/edit reminder list names
        // Filter to show courses that either:
        // 1. Don't have a reminder_list set, OR
        // 2. Have a reminder_list that equals the course_name (default case that should be changed)
        const coursesNeedingSetup = data.filter(course => {
            if (!course || !course.name) return false;
            const reminderList = course.reminder_list ? course.reminder_list.trim() : '';
            const hasReminderList = reminderList !== '';
            const isDefaultName = reminderList === course.name;
            // Show if no reminder list OR if it's set to the default (course name)
            return !hasReminderList || isDefaultName;
        });
        
        if (coursesNeedingSetup.length === 0) {
            coursesList.innerHTML = '<p style="color: #666; font-style: italic;">All courses have reminder list names set.</p>';
            return;
        }
        
        coursesList.innerHTML = '';
        coursesNeedingSetup.forEach(course => {
            const isEnabled = course.enabled === true || course.enabled === 1 || course.enabled === '1';
            // Don't autofill disabled courses - always start with empty value
            const currentReminderList = (isEnabled && course.reminder_list) ? course.reminder_list.trim() : '';
            const courseItem = document.createElement('div');
            courseItem.className = 'course-item';
            courseItem.style.marginBottom = '10px';
            
            courseItem.innerHTML = `
                <div class="course-info" style="flex: 1;">
                    <strong>${escapeHtml(course.name)}</strong>
                    ${!isEnabled ? '<span style="margin-left: 8px; font-size: 0.85em; color: #999; font-style: italic;">(Disabled)</span>' : ''}
                    <div style="margin-top: 8px;">
                        <input type="text" 
                               class="form-select reminder-list-input" 
                               data-course-name="${escapeHtml(course.name)}"
                               placeholder="Enter reminder list name (required)"
                               value="${escapeHtml(currentReminderList)}"
                               autocomplete="off"
                               spellcheck="false"
                               style="width: 100%; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
                    </div>
                </div>
            `;
            
            // Add event listener to update border color as user types
            const input = courseItem.querySelector('.reminder-list-input');
            // Set initial border color based on current value (only for enabled courses)
            if (currentReminderList && isEnabled) {
                input.style.borderColor = '#4caf50';
            }
            input.addEventListener('input', function() {
                if (this.value.trim()) {
                    this.style.borderColor = '#4caf50'; // Green when filled
                } else {
                    this.style.borderColor = '#e0e0e0'; // Gray when empty
                }
            });
            
            coursesList.appendChild(courseItem);
        });
    } catch (error) {
        console.error('Error loading setup courses:', error);
    }
}

async function performSync() {
    const btn = document.getElementById('syncBtn');
    const progressContainer = document.getElementById('syncProgress');
    const progressText = document.getElementById('syncProgressText');
    const progressBar = document.getElementById('syncProgressBar');
    const progressDetails = document.getElementById('syncProgressDetails');
    
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    
    // Show progress indicator
    progressContainer.style.display = 'block';
    progressText.textContent = 'Starting sync...';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '';
    progressDetails.innerHTML = '';
    
    try {
        // Use EventSource for Server-Sent Events
        const eventSource = new EventSource('/api/sync?ai_enabled=true');
        
        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'progress') {
                    // Update progress bar and message
                    progressBar.style.width = data.progress + '%';
                    progressText.textContent = data.message || 'Syncing...';
                    
                    // Update details with current activity
                    if (data.message) {
                        progressDetails.innerHTML = `<span style="color: #666;">${escapeHtml(data.message)}</span>`;
                    }
                    
                    // If assignment data is included, add it to the list
                    if (data.assignment) {
                        // Add assignment to the assignments array if it doesn't exist
                        const existingIndex = assignments.findIndex(a => a.assignment_id === data.assignment.assignment_id);
                        if (existingIndex === -1) {
                            assignments.push(data.assignment);
                            // Sort assignments by due date to keep them in order
                            assignments.sort((a, b) => {
                                if (!a.due_at && !b.due_at) return 0;
                                if (!a.due_at) return 1;
                                if (!b.due_at) return -1;
                                return new Date(a.due_at) - new Date(b.due_at);
                            });
                            // Re-display assignments to show the new one
                            filterAssignments();
                            updateStats();
                        }
                    }
                } else if (data.type === 'complete') {
                    // Sync complete
                    eventSource.close();
                    progressBar.style.width = '100%';
                    progressText.textContent = 'Sync complete!';
                    
                    if (data.total_added > 0) {
                        showStatus(`Successfully synced ${data.total_added} new assignments!`, 'success');
                        progressDetails.innerHTML = `<span style="color: #4caf50;">✓ Successfully synced ${data.total_added} new assignment${data.total_added === 1 ? '' : 's'}!</span>`;
                    } else {
                        showStatus('No new assignments to add. You\'re all caught up!', 'info');
                        progressDetails.innerHTML = '<span style="color: #666;">No new assignments to add. You\'re all caught up!</span>';
                    }
                    
                    await loadAssignments();
                    await loadCourses();
                    const settingsModal = document.getElementById('settingsModal');
                    if (settingsModal.style.display === 'block') {
                        await loadCoursesInSettings();
                    }
                    
                    // Check if there are new courses that need reminder list names
                    const needsSetup = await checkSetupRequired();
                    if (needsSetup) {
                        setTimeout(() => {
                            showSetupModal(false, null, 'New courses detected! Please set reminder list names for all courses below.');
                        }, 2000);
                    }
                    
                    // Hide progress after a delay
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 3000);
                    
                    btn.disabled = false;
                    btn.textContent = 'Sync Assignments';
                } else if (data.type === 'error') {
                    // Error occurred
                    eventSource.close();
                    showStatus('Error: ' + data.error, 'error');
                    progressDetails.innerHTML = '<span style="color: #d32f2f;">Error: ' + escapeHtml(data.error) + '</span>';
                    progressBar.style.width = '100%';
                    progressBar.style.backgroundColor = '#d32f2f';
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 5000);
                    btn.disabled = false;
                    btn.textContent = 'Sync Assignments';
                }
            } catch (parseError) {
                console.error('Error parsing SSE data:', parseError);
            }
        };
        
        eventSource.onerror = (error) => {
            eventSource.close();
            showStatus('Error syncing: Connection error', 'error');
            progressDetails.innerHTML = '<span style="color: #d32f2f;">Connection error occurred</span>';
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = '#d32f2f';
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 5000);
            btn.disabled = false;
            btn.textContent = 'Sync Assignments';
        };
        
    } catch (error) {
        showStatus('Error syncing: ' + error.message, 'error');
        progressDetails.innerHTML = '<span style="color: #d32f2f;">Error: ' + escapeHtml(error.message) + '</span>';
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#d32f2f';
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 5000);
        btn.disabled = false;
        btn.textContent = 'Sync Assignments';
    }
}

async function saveAndSync() {
    const collegeSelect = document.getElementById('setupCollegeName');
    const collegeCustom = document.getElementById('setupCollegeNameCustom');
    const autoSyncCheckbox = document.getElementById('setupAutoSyncReminders');
    const warningDiv = document.getElementById('setupWarningMessage');
    const newCollegeName = collegeSelect.value === 'Other' ? collegeCustom.value.trim() : collegeSelect.value;
    
    // Validate college name
    if (!newCollegeName) {
        warningDiv.textContent = 'Please select or enter your college or university name.';
        warningDiv.style.display = 'block';
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';
        if (collegeSelect.value === 'Other') {
            collegeCustom.focus();
            collegeCustom.style.borderColor = '#d32f2f';
        } else {
            collegeSelect.focus();
            collegeSelect.style.borderColor = '#d32f2f';
        }
        // Scroll to top of modal to show warning
        warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    
    const autoSyncEnabled = autoSyncCheckbox.checked;
    
    // Always collect reminder list names (required for all courses)
    const reminderListInputs = document.querySelectorAll('.reminder-list-input');
    const coursesToUpdate = [];
    const missingCourses = [];
    
    // Always require reminder list names
    reminderListInputs.forEach(input => {
        const courseName = input.dataset.courseName;
        const reminderList = input.value.trim();
        
        if (!reminderList) {
            missingCourses.push(courseName);
            input.style.borderColor = '#d32f2f'; // Red for missing
            // Scroll to first missing input
            if (missingCourses.length === 1) {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                input.focus();
            }
        } else {
            input.style.borderColor = '#4caf50'; // Green for valid
            coursesToUpdate.push({ course_name: courseName, reminder_list: reminderList });
        }
    });
    
    if (missingCourses.length > 0) {
        const courseList = missingCourses.length <= 3 
            ? missingCourses.join(', ') 
            : `${missingCourses.slice(0, 3).join(', ')} and ${missingCourses.length - 3} more`;
        warningDiv.textContent = `Please fill in reminder list names for: ${courseList}`;
        warningDiv.style.display = 'block';
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';
        // Scroll to top of modal to show warning
        warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    
    // Clear warning if validation passes
    warningDiv.style.display = 'none';
    
    try {
        // Save college name and auto-sync setting
        const settingsResponse = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                college_name: newCollegeName,
                auto_sync_reminders: autoSyncEnabled ? '1' : '0'
            })
        });
        
        const settingsData = await settingsResponse.json();
        if (!settingsData.success) {
            showStatus('Error saving settings: ' + (settingsData.error || 'Unknown error'), 'error');
            return;
        }
        
        collegeName = newCollegeName;
        
        // Save reminder list names for all courses
        for (const course of coursesToUpdate) {
            await fetch('/api/course-mapping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(course)
            });
        }
        
        // Reload assignments to get updated reminder_list values
        await loadAssignments();
        
        // Close modal
        closeSetupModal();
        
        // If this was triggered from "Add to Reminders", add the reminder now
        if (pendingReminderAssignmentId) {
            const assignmentId = pendingReminderAssignmentId;
            pendingReminderAssignmentId = null;
            
            // Find the button and add the reminder
            const button = document.querySelector(`.btn-add-reminder[data-assignment-id="${assignmentId}"]`);
            if (button) {
                await addReminder(assignmentId, button);
            } else {
                showStatus('Please click "Add to Reminders" again now that reminder lists are set.', 'info');
            }
        } else {
            // Otherwise, sync assignments
            await performSync();
        }
        
    } catch (error) {
        showStatus('Error saving setup: ' + error.message, 'error');
    }
}

function closeSetupModal() {
    const modal = document.getElementById('setupModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function saveSettings() {
    const select = document.getElementById('collegeName');
    const customInput = document.getElementById('collegeNameCustom');
    const autoSyncCheckbox = document.getElementById('settingsAutoSyncReminders');
    const warningDiv = document.getElementById('settingsWarningMessage');
    
    const newCollegeName = select.value === 'Other' ? customInput.value.trim() : select.value;
    
    // Validate college name
    if (!newCollegeName) {
        warningDiv.textContent = 'Please select or enter your college or university name.';
        warningDiv.style.display = 'block';
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';
        if (select.value === 'Other') {
            customInput.focus();
            customInput.style.borderColor = '#d32f2f';
        } else {
            select.focus();
            select.style.borderColor = '#d32f2f';
        }
        // Scroll to top of modal to show warning
        warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    
    // Clear warning if validation passes
    warningDiv.style.display = 'none';
    
    const autoSyncEnabled = autoSyncCheckbox ? autoSyncCheckbox.checked : false;
    
    try {
        // Save basic settings first
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                college_name: newCollegeName,
                auto_sync_reminders: autoSyncEnabled ? '1' : '0'
            })
        });
        
        const data = await response.json();
        if (data.success) {
            collegeName = newCollegeName;
            
            // Apply all enable/disable changes
            for (const [courseName, enabled] of Object.entries(courseEnableDisableChanges)) {
                try {
                    const endpoint = enabled ? '/api/course-mapping/enable' : '/api/course-mapping/disable';
                    await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ course_name: courseName })
                    });
                } catch (error) {
                    console.error(`Error ${enabled ? 'enabling' : 'disabling'} course ${courseName}:`, error);
                }
            }
            
            // Clear pending changes
            courseEnableDisableChanges = {};
            
            showStatus('Settings saved!', 'success');
            await loadCoursesInSettings();
            await loadCourses();
            closeModal();
            const status = document.getElementById('status');
            if (status.className.includes('warning')) {
                status.style.display = 'none';
            }
        }
    } catch (error) {
        showStatus('Error saving settings: ' + error.message, 'error');
    }
}

function editReminderList(courseName, currentReminderList) {
    const newReminderList = prompt(`Enter reminder list name for "${courseName}":`, currentReminderList || '');
    if (newReminderList === null) return; // User cancelled
    
    const trimmed = newReminderList.trim();
    if (!trimmed) {
        showStatus('Reminder list name cannot be empty.', 'error');
        return;
    }
    
    // Update via API
    fetch('/api/course-mapping', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            course_name: courseName,
            reminder_list: trimmed
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showStatus('Reminder list updated!', 'success');
            loadCoursesInSettings();
        } else {
            showStatus('Error updating reminder list: ' + (data.error || 'Unknown error'), 'error');
        }
    })
    .catch(error => {
        showStatus('Error updating reminder list: ' + error.message, 'error');
    });
}

async function openSettings() {
    const modal = document.getElementById('settingsModal');
    // Reset pending enable/disable changes and original states
    courseEnableDisableChanges = {};
    originalCourseStates = {};
    // Reload settings to discard any unsaved changes
    await loadSettings();
    // Clear any warning messages
    const warningDiv = document.getElementById('settingsWarningMessage');
    if (warningDiv) {
        warningDiv.style.display = 'none';
    }
    modal.style.display = 'block';
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('settingsModal');
    // Discard pending enable/disable changes and original states
    courseEnableDisableChanges = {};
    originalCourseStates = {};
    // Clear any warning messages
    const warningDiv = document.getElementById('settingsWarningMessage');
    if (warningDiv) {
        warningDiv.style.display = 'none';
    }
    modal.style.display = 'none';
    // Restore body scroll when modal is closed
    document.body.style.overflow = '';
}

function displayAssignments(assignmentsToShow) {
    const list = document.getElementById('assignmentsList');
    
    if (assignmentsToShow.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No assignments found.</p>';
        return;
    }
    
    list.innerHTML = assignmentsToShow.map((assignment) => {
        // Get title and strip any HTML tags if present
        let title = assignment.title || '';
        
        if (title) {
            // Strip HTML tags from title
            const tmp = document.createElement('div');
            tmp.innerHTML = title;
            title = tmp.textContent || tmp.innerText || '';
        }
        
        if (!title.trim()) {
            title = 'Untitled Assignment';
        }
        
        // Format due date
        let formattedDate = 'No due date';
        if (assignment.due_at) {
            const dueDate = new Date(assignment.due_at);
            if (!isNaN(dueDate.getTime())) {
                formattedDate = dueDate.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric'
                }) + ' at ' + dueDate.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            }
        }
        
        // Get course name
        const courseName = assignment.course_name || 'Unknown Course';
        
        // Get AI notes and strip HTML
        let aiNotes = '';
        if (assignment.ai_notes && assignment.ai_notes.trim()) {
            const tmp = document.createElement('div');
            tmp.innerHTML = assignment.ai_notes;
            aiNotes = tmp.textContent || tmp.innerText || '';
        }
        
        const aiNotesSection = aiNotes ? 
            `<div class="assignment-ai-notes"><strong>AI Summary:</strong><br>${escapeHtml(aiNotes)}</div>` : '';
        
        return `
            <div class="assignment-card" data-assignment-id="${escapeHtml(assignment.assignment_id)}">
                <div class="assignment-course-badge">${escapeHtml(courseName)}</div>
                <div class="assignment-header">
                    <div class="assignment-title">${escapeHtml(title)}</div>
                    <div class="assignment-header-right">
                        <div class="assignment-due">Due: ${escapeHtml(formattedDate)}</div>
                        ${assignment.reminder_added === 1 || assignment.reminder_added === true
                            ? `<button type="button" class="btn-reminder-link btn-reminder-added" data-assignment-id="${escapeHtml(assignment.assignment_id)}" disabled>✓ Added</button>`
                            : `<button type="button" class="btn-reminder-link btn-add-reminder" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Add to Reminders</button>`
                        }
                    </div>
                </div>
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
        filtered = filtered.filter(a => a && a.course_name === courseFilter);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(a => {
            if (!a) return false;
            const title = (a.title || '').toLowerCase();
            const courseName = (a.course_name || '').toLowerCase();
            return title.includes(searchTerm) || courseName.includes(searchTerm);
        });
    }
    
    displayAssignments(filtered);
    updateStats(filtered);
    
    // Re-attach event listeners for reminder buttons
    attachReminderListeners();
}

function attachReminderListeners() {
    // Use event delegation on the assignments list container to avoid issues with dynamic content
    const assignmentsList = document.getElementById('assignmentsList');
    if (!assignmentsList) return;
    
    // Remove old listener if it exists
    assignmentsList.removeEventListener('click', handleReminderButtonClick);
    
    // Add new listener using event delegation
    assignmentsList.addEventListener('click', handleReminderButtonClick);
}

function handleReminderButtonClick(e) {
    // Check if the clicked element is a reminder button or inside one
    const button = e.target.closest('.btn-add-reminder');
    if (!button) return;
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const assignmentId = button.dataset.assignmentId;
    if (assignmentId) {
        console.log('Adding reminder for assignment:', assignmentId);
        addReminder(assignmentId, button);
    }
    return false;
}

async function addReminder(assignmentId, buttonElement) {
    console.log('addReminder called with:', assignmentId);
    try {
        // Check if reminder lists are set up for the assignment's course
        const assignment = assignments.find(a => a.assignment_id === assignmentId);
        if (!assignment) {
            console.error('Assignment not found:', assignmentId);
            showStatus('Assignment not found.', 'error');
            return;
        }
        
        console.log('Assignment found:', assignment);
        
        // Check if the assignment has a reminder list name set
        if (!assignment.reminder_list || assignment.reminder_list.trim() === '') {
            console.log('No reminder list set for assignment');
            showSetupModal(false, assignmentId, `Please set a reminder list name for "${assignment.course_name}" below.`);
            return;
        }
        
        console.log('Adding reminder with list:', assignment.reminder_list);
        buttonElement.disabled = true;
        buttonElement.textContent = 'Adding...';
        
        const response = await fetch('/api/assignments/add-reminder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        
        console.log('Response received:', response.status);
        const data = await response.json();
        console.log('Response data:', data);
        
        if (data.error) {
            console.error('Error from server:', data.error);
            showStatus('Error adding reminder: ' + data.error, 'error');
            buttonElement.disabled = false;
            buttonElement.textContent = 'Add to Reminders';
        } else {
            console.log('Reminder added successfully');
            showStatus('Reminder added successfully!', 'success');
            // Update the assignment in our local array
            const assignment = assignments.find(a => a.assignment_id === assignmentId);
            if (assignment) {
                assignment.reminder_added = 1;
            }
            
            // Change button to show it's been added
            buttonElement.classList.remove('btn-add-reminder');
            buttonElement.classList.add('btn-reminder-added');
            buttonElement.textContent = '✓ Added';
            buttonElement.disabled = true;
        }
    } catch (error) {
        console.error('Exception in addReminder:', error);
        showStatus('Error adding reminder: ' + error.message, 'error');
        buttonElement.disabled = false;
        buttonElement.textContent = 'Add to Reminders';
    }
}

function updateStats(assignmentsToCount = null) {
    const assignmentsToUse = assignmentsToCount !== null ? assignmentsToCount : assignments;
    const total = assignmentsToUse.length;
    
    document.getElementById('totalAssignments').textContent = total;
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
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


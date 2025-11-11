let assignments = [];
let courses = [];
let collegeName = null;
let pendingReminderAssignmentId = null;
let courseEnableDisableChanges = {};
let reminderListChanges = {};
let originalCourseStates = {};
let isSetupModalForced = false;
let activeAISummaryRequests = 0;
let activeAddReminderRequests = 0;
let isSyncInProgress = false;
let isInsightsModalLoading = false;
let isAddAssignmentWorkflow = false;
let aiSummaryEnabled = true;
let currentFilter = 'all'; // 'all', 'completed', 'deleted', or course name
let currentFilterCourse = null;
let focusedAssignmentId = null; // Track which assignment is focused for keyboard shortcuts

function setButtonVisualState(button, disabled, disabledTitle) {
    if (!button) return;
    button.disabled = !!disabled;
    if (disabled) {
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
        if (disabledTitle !== undefined) {
            button.dataset.disabledTitle = disabledTitle;
            button.title = disabledTitle;
        }
    } else {
        button.style.opacity = '';
        button.style.cursor = '';
        if (disabledTitle !== undefined || button.dataset.disabledTitle !== undefined) {
            if (button.dataset.disabledTitle !== undefined) {
                delete button.dataset.disabledTitle;
            }
            button.title = '';
        }
    }
}

function updateSyncButtonState() {
    const btn = document.getElementById('syncBtn');
    if (!btn) return;
    let disabled = false;
    let reason;

    if (isSyncInProgress) {
        disabled = true;
        reason = 'Sync in progress';
    } else if (activeAddReminderRequests > 0) {
        disabled = true;
        reason = 'Adding reminder';
    } else if (isInsightsModalLoading) {
        disabled = true;
        reason = 'AI insights are generating';
    } else if (activeAISummaryRequests > 0) {
        disabled = true;
        reason = 'Please wait for AI summary generation to finish';
    } else if (isAddAssignmentWorkflow) {
        disabled = true;
        reason = 'Adding assignment';
    }

    setButtonVisualState(btn, disabled, reason);
}

function refreshPrimaryButtonsState() {
    updateSyncButtonState();
    updateAIInsightsButtonState();
    updateAddAssignmentButtonState();
    updateSettingsButtonState();
    updateAssignmentActionButtonsState();
}

document.addEventListener('DOMContentLoaded', async () => {
    loadCourses();
    loadAssignments();
    await loadSettings({ suppressSetupCheck: true });
    const needsInitialSetup = await checkSetupRequired();
    if (needsInitialSetup) {
        showSetupModal(false, null, null, true);
    }

    attachReminderListeners();
    attachAISummaryListeners();

    document.getElementById('addClassBtn').addEventListener('click', openAddClassModal);
    document.getElementById('syncBtn').addEventListener('click', syncAssignments);
    // Settings button is now in sidebar, handled via onclick in HTML
    // Settings auto-save on change - no save button needed
    document.getElementById('aiInsightsBtn').addEventListener('click', () => {
        const btn = document.getElementById('aiInsightsBtn');
        if (
            btn.disabled ||
            isSyncInProgress ||
            isInsightsModalLoading ||
            isAddAssignmentWorkflow ||
            activeAISummaryRequests > 0 ||
            activeAddReminderRequests > 0
        ) {
            return;
        }
        if (insightsExist && cachedInsightsEndDate) {
            showAIInsights(false, cachedInsightsEndDate);
        } else {
            openAIInsightsDateModal(false);
        }
    });
    document.getElementById('refreshInsightsBtn').addEventListener('click', () => {
        if (isInsightsModalLoading) return;
        closeAIInsightsModal();
        openAIInsightsDateModal(true);
    });
    document.getElementById('generateInsightsBtn').addEventListener('click', generateAIInsights);
    
    // Sidebar navigation
    document.getElementById('sidebarAll').addEventListener('click', () => setFilter('all'));
    document.getElementById('sidebarDeleted').addEventListener('click', () => setFilter('deleted'));
    
    // Keyboard shortcuts for delete
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Right-click context menu
    document.addEventListener('contextmenu', handleRightClick);
    document.addEventListener('click', () => {
        // Close context menu on click
        const contextMenu = document.getElementById('contextMenu');
        if (contextMenu) {
            contextMenu.remove();
        }
    });
    document.getElementById('saveAndSync').addEventListener('click', saveAndSync);
    document.getElementById('cancelSetup').addEventListener('click', () => {
        if (isSetupModalForced) {
            return;
        }
        closeSetupModal();
    });



    const setupAutoSyncCheckbox = document.getElementById('setupAutoSyncReminders');
    if (setupAutoSyncCheckbox) {
        setupAutoSyncCheckbox.addEventListener('change', async (e) => {
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
        if (e.target === setupModal && !isSetupModalForced) {
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
            populateSidebarCourses();
            filterAssignments();
            updateStats();
            attachReminderListeners();
            attachAISummaryListeners();
        }
        refreshPrimaryButtonsState();
    } catch (error) {
        console.error('Error loading assignments:', error);
        assignments = [];
        populateSidebarCourses();
        displayAssignments([]);
        refreshPrimaryButtonsState();
    }
}

function updateAIInsightsButtonState() {
    const btn = document.getElementById('aiInsightsBtn');
    if (!btn) return;

    const hasAssignments = assignments && assignments.length > 0;
    let disabledReason;

    if (!hasAssignments) {
        disabledReason = 'Please sync assignments first';
    } else if (activeAddReminderRequests > 0) {
        disabledReason = 'Adding reminder';
    } else if (activeAISummaryRequests > 0) {
        disabledReason = 'Please wait for AI summary generation to finish';
    } else if (isSyncInProgress) {
        disabledReason = 'Please wait for sync to complete';
    } else if (isInsightsModalLoading) {
        disabledReason = 'AI insights are generating';
    } else if (isAddAssignmentWorkflow) {
        disabledReason = 'Adding assignment';
    }

    setButtonVisualState(btn, !!disabledReason, disabledReason);
    if (!disabledReason) {
        btn.title = '';
    }
}

function updateAddAssignmentButtonState() {
    // This function is kept for compatibility but no longer needed since addAssignmentBtn was removed
    return;
}

function updateSettingsButtonState() {
    const btn = document.getElementById('settingsBtn');
    if (!btn) return;
    let disabled = false;
    let reason;
    if (isSyncInProgress) {
        disabled = true;
        reason = 'Sync in progress';
    } else if (activeAddReminderRequests > 0) {
        disabled = true;
        reason = 'Adding reminder';
    } else if (isInsightsModalLoading) {
        disabled = true;
        reason = 'AI insights are generating';
    } else if (activeAISummaryRequests > 0) {
        disabled = true;
        reason = 'Please wait for AI summary generation to finish';
    } else if (isAddAssignmentWorkflow) {
        disabled = true;
        reason = 'Adding assignment';
    }
    setButtonVisualState(btn, disabled, reason);
}

function updateAssignmentActionButtonsState() {
    const disable =
        isSyncInProgress ||
        isInsightsModalLoading ||
        activeAddReminderRequests > 0 ||
        isAddAssignmentWorkflow ||
        activeAISummaryRequests > 0;
    let reason = '';
    if (isSyncInProgress) reason = 'Sync in progress';
    else if (isInsightsModalLoading) reason = 'AI insights are generating';
    else if (activeAddReminderRequests > 0) reason = 'Adding reminder';
    else if (isAddAssignmentWorkflow) reason = 'Adding assignment';
    else if (activeAISummaryRequests > 0) reason = 'Please wait for AI summary generation to finish';
    try {
        document.querySelectorAll('.btn-generate-ai-summary').forEach(btn => {
            setButtonVisualState(btn, disable, reason);
        });
        document.querySelectorAll('.btn-add-reminder').forEach(btn => {
            setButtonVisualState(btn, disable, reason);
        });
    } catch (e) {
    }
}

async function loadCourses() {
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();

        if (data.error) {
            console.error('Error loading courses:', data.error);
            courses = [];
            populateSidebarCourses();
            return;
        }

        if (!Array.isArray(data)) {
            console.error('Invalid courses data format:', data);
            courses = [];
            populateSidebarCourses();
            return;
        }

        courses = data;
        populateSidebarCourses();
    } catch (error) {
        console.error('Error loading courses:', error);
        courses = [];
        populateSidebarCourses();
    }
}

function populateSidebarCourses() {
    const sidebarCourses = document.getElementById('sidebarCourses');
    if (!sidebarCourses) return;

    sidebarCourses.innerHTML = '';

    // Get unique reminder list names from assignments (for display)
    // But track the official course_name for filtering
    const reminderListToCourseName = new Map();
    assignments.forEach(a => {
        if (a && a.course_name && !a.deleted) {
            const displayName = (a.reminder_list && a.reminder_list.trim()) 
                ? a.reminder_list.trim() 
                : a.course_name;
            // Map display name to official course name for filtering
            if (!reminderListToCourseName.has(displayName)) {
                reminderListToCourseName.set(displayName, a.course_name);
            }
        }
    });

    // Also add courses from the courses list
    courses.forEach(c => {
        if (c && c.name && (c.enabled === true || c.enabled === 1 || c.enabled === '1')) {
            const displayName = (c.reminder_list && c.reminder_list.trim()) 
                ? c.reminder_list.trim() 
                : c.name;
            if (!reminderListToCourseName.has(displayName)) {
                reminderListToCourseName.set(displayName, c.name);
            }
        }
    });

    const sortedDisplayNames = Array.from(reminderListToCourseName.keys()).sort();

    sortedDisplayNames.forEach(displayName => {
        const courseItem = document.createElement('button');
        courseItem.className = 'sidebar-course-item';
        const officialCourseName = reminderListToCourseName.get(displayName);
        courseItem.dataset.course = officialCourseName; // Store official name for filtering
        courseItem.innerHTML = `
            <span class="sidebar-label">${escapeHtml(displayName)}</span>
        `;
        courseItem.addEventListener('click', () => setFilter('course', officialCourseName));
        sidebarCourses.appendChild(courseItem);
    });

    updateSidebarActiveState();
    updateSidebarCounts();
}

function setFilter(filterType, courseName = null) {
    currentFilter = filterType;
    currentFilterCourse = courseName;
    
    updateSidebarActiveState();
    
    // Handle deleted filter separately - load from deleted_assignments table
    if (filterType === 'deleted') {
        displayDeletedAssignmentsInMainView();
    } else {
        filterAssignments();
    }
    
    // Update header title
    const titleEl = document.getElementById('currentViewTitle');
    if (titleEl) {
        if (filterType === 'all') {
            titleEl.textContent = 'All Classes';
        } else if (filterType === 'completed') {
            titleEl.textContent = 'Completed';
        } else if (filterType === 'deleted') {
            titleEl.textContent = 'Recently Deleted';
        } else if (filterType === 'course' && courseName) {
            titleEl.textContent = courseName;
        }
    }
}

function updateSidebarActiveState() {
    // Remove active from all items
    document.querySelectorAll('.sidebar-item, .sidebar-course-item').forEach(item => {
        item.classList.remove('active');
    });

    // Add active to current filter
    if (currentFilter === 'all') {
        document.getElementById('sidebarAll')?.classList.add('active');
    } else if (currentFilter === 'deleted') {
        document.getElementById('sidebarDeleted')?.classList.add('active');
    } else if (currentFilter === 'course' && currentFilterCourse) {
        const courseItem = document.querySelector(`.sidebar-course-item[data-course="${escapeHtml(currentFilterCourse)}"]`);
        if (courseItem) {
            courseItem.classList.add('active');
        }
    }
}

function updateSidebarCounts() {
    // Update deleted count
    const deletedCount = assignments.filter(a => a && a.deleted).length;
    const deletedBadge = document.getElementById('deletedCount');
    if (deletedBadge) {
        deletedBadge.textContent = deletedCount;
        deletedBadge.style.display = deletedCount > 0 ? 'inline-block' : 'none';
    }
}



async function loadSettings({ suppressSetupCheck = false } = {}) {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();

        if (data.college_name) {
            collegeName = data.college_name;
            const input = document.getElementById('collegeName');
            if (input) input.value = data.college_name;
            const setupInput = document.getElementById('setupCollegeName');
            if (setupInput) setupInput.value = data.college_name;
        }

        const autoSyncCheckbox = document.getElementById('settingsAutoSyncReminders');
        if (autoSyncCheckbox) {
            autoSyncCheckbox.checked = data.auto_sync_reminders === '1' || data.auto_sync_reminders === true;
        }
        
        const aiSummaryCheckbox = document.getElementById('settingsAiSummaryEnabled');
        if (aiSummaryCheckbox) {
            aiSummaryCheckbox.checked = data.ai_summary_enabled !== '0';
        }
        aiSummaryEnabled = data.ai_summary_enabled !== '0';
        
        await loadCoursesInSettings();
        await checkInsightsExist();

        if (!suppressSetupCheck) {
            const needsSetup = await checkSetupRequired();
            if (needsSetup) {
                showSetupModal(false, null, null, true);
            }
        }
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
        const canvasCourses = [];
        const manualCourses = [];
        
        // Separate Canvas courses from manually added courses
        data.forEach(course => {
            if (!course || !course.name) {
                return;
            }
            
            // Manually added courses don't have a Canvas ID
            if (course.id === null || course.id === undefined) {
                manualCourses.push(course);
            } else {
                canvasCourses.push(course);
            }
        });
        
        // Display Canvas courses first
        const canvasCourseNames = new Set();
        canvasCourses.forEach(course => {
            const courseItem = document.createElement('div');
            const isEnabled = course.enabled === true || course.enabled === 1 || course.enabled === '1';
            const courseName = String(course.name || '');
            canvasCourseNames.add(courseName);

            originalCourseStates[courseName] = isEnabled;

            const currentState = courseEnableDisableChanges[courseName] !== undefined
                ? courseEnableDisableChanges[courseName]
                : isEnabled;

            courseItem.className = `course-item ${!currentState ? 'course-disabled' : ''}`;

            const reminderList = course.reminder_list ? String(course.reminder_list).trim() : '';
            // Use pending change if exists, otherwise use saved value
            // For disabled courses, don't show reminder list value
            let displayReminderList = '';
            if (currentState) {
                displayReminderList = reminderListChanges[courseName] !== undefined 
                    ? reminderListChanges[courseName] 
                    : (reminderList || courseName);
            } else {
                // Disabled courses: only show if there's a pending change, otherwise empty
                displayReminderList = reminderListChanges[courseName] !== undefined 
                    ? reminderListChanges[courseName] 
                    : '';
            }

            const actionButton = document.createElement('button');
            actionButton.className = currentState ? 'btn-delete' : 'btn-enable';
            actionButton.textContent = currentState ? 'Disable' : 'Enable';
            actionButton.dataset.courseName = courseName;
            
            // Disable the Enable button if there's no reminder list name
            if (!currentState) {
                const hasReminderList = displayReminderList && displayReminderList.trim() !== '' && displayReminderList !== 'Enter reminder list name to enable';
                actionButton.disabled = !hasReminderList;
                if (actionButton.disabled) {
                    actionButton.style.opacity = '0.5';
                    actionButton.style.cursor = 'not-allowed';
                    actionButton.title = 'Enter a reminder list name to enable';
                } else {
                    actionButton.title = 'Enable course';
                }
            } else {
                actionButton.title = 'Disable course';
            }
            
            actionButton.addEventListener('click', () => {
                if (!actionButton.disabled) {
                    toggleCourseEnabled(courseName, courseItem, actionButton);
                }
            });

            const courseInfo = document.createElement('div');
            courseInfo.className = 'course-info';

            const reminderListSpan = document.createElement('span');
            reminderListSpan.className = 'reminder-list-editable';

            const hasValidReminderList = displayReminderList && displayReminderList.trim() !== '';
            // For disabled courses, show placeholder text instead of value
            if (!currentState && !hasValidReminderList) {
                reminderListSpan.textContent = 'Enter reminder list name to enable';
                reminderListSpan.style.color = '#86868b';
                reminderListSpan.style.fontStyle = 'italic';
            } else {
                reminderListSpan.textContent = displayReminderList || 'Enter reminder list name';
                reminderListSpan.style.color = '#667eea';
                reminderListSpan.style.fontStyle = 'normal';
            }
            reminderListSpan.dataset.courseName = courseName;
            reminderListSpan.dataset.reminderList = displayReminderList;
            reminderListSpan.title = currentState ? 'Click to edit reminder list name' : 'Click to set reminder list name and enable';
            reminderListSpan.style.cursor = 'pointer';
            reminderListSpan.style.textDecoration = 'underline';
            reminderListSpan.style.textDecorationStyle = 'dotted';
            reminderListSpan.style.fontWeight = 'normal';

            reminderListSpan.addEventListener('click', () => {
                // For disabled courses, pass empty string instead of course name
                const defaultValue = currentState ? (reminderList || courseName) : '';
                editReminderList(courseName, defaultValue);
            });

            courseInfo.innerHTML = `
                <strong>${escapeHtml(courseName)}</strong>
                <div style="margin-top: 4px; font-size: 0.85em;">
                    <span style="color: #666;">Reminder List: </span>
                </div>
            `;
            courseInfo.querySelector('div').appendChild(reminderListSpan);

            if (!currentState) {
                const disabledLabel = document.createElement('span');
                disabledLabel.className = 'disabled-label';
                disabledLabel.textContent = '(Disabled)';
                courseInfo.appendChild(disabledLabel);
            }

            courseItem.className = `course-item ${!currentState ? 'course-disabled' : ''}`;

            courseItem.appendChild(courseInfo);
            courseItem.appendChild(actionButton);
            coursesList.appendChild(courseItem);
        });
        
        // Display manually added courses separately
        if (manualCourses.length > 0) {
            const separator = document.createElement('div');
            separator.style.width = '100%';
            separator.innerHTML = `
                <div style="border-top: 1px solid var(--border-color); margin: 25px 0 15px;"></div>
                <div style="font-weight: 700; color: var(--primary-color); margin-bottom: 12px;">Manually Added Courses</div>
            `;
            coursesList.appendChild(separator);

            manualCourses.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(course => {
                const courseName = String(course.name || '');
                const reminderList = course.reminder_list ? String(course.reminder_list).trim() : courseName;
                
                // Use pending change if exists, otherwise use saved value
                const currentName = reminderListChanges[courseName] !== undefined 
                    ? reminderListChanges[courseName] 
                    : reminderList;

                const item = document.createElement('div');
                item.className = 'course-item';

                const courseInfo = document.createElement('div');
                courseInfo.className = 'course-info';
                courseInfo.style.flex = '1';

                // Single editable name field (name = reminder list for manual courses)
                const nameSpan = document.createElement('span');
                nameSpan.className = 'reminder-list-editable';
                nameSpan.textContent = currentName;
                nameSpan.dataset.courseName = courseName;
                nameSpan.dataset.reminderList = currentName;
                nameSpan.title = 'Click to rename';
                nameSpan.style.cursor = 'pointer';
                nameSpan.style.color = '#667eea';
                nameSpan.style.textDecoration = 'underline';
                nameSpan.style.textDecorationStyle = 'dotted';
                nameSpan.style.fontWeight = '500';
                nameSpan.style.fontSize = '1em';
                nameSpan.addEventListener('click', () => {
                    editManualCourseName(courseName, reminderList);
                });

                courseInfo.appendChild(nameSpan);

                // Delete button
                const deleteButton = document.createElement('button');
                deleteButton.className = 'btn-delete';
                deleteButton.textContent = 'Delete';
                deleteButton.title = 'Delete this course';
                deleteButton.dataset.courseName = courseName;
                deleteButton.addEventListener('click', () => {
                    deleteManualCourse(courseName);
                });

                item.appendChild(courseInfo);
                item.appendChild(deleteButton);
                coursesList.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Error loading courses:', error);
        document.getElementById('coursesList').innerHTML = '<p style="color: #d32f2f;">Error loading courses</p>';
    }
}

async function toggleCourseEnabled(courseName, courseItem, actionButton) {
    const currentState = courseEnableDisableChanges[courseName] !== undefined
        ? courseEnableDisableChanges[courseName]
        : (originalCourseStates[courseName] !== undefined ? originalCourseStates[courseName] : true);

    const newState = !currentState;
    
    // If enabling, check if reminder list is set
    if (newState) {
        // Get current reminder list from the course info
        const reminderListSpan = courseItem.querySelector('.reminder-list-editable');
        const currentReminderList = reminderListSpan ? reminderListSpan.textContent.trim() : '';
        
        // Also check if there's a pending change
        const pendingReminderList = reminderListChanges[courseName];
        const reminderList = pendingReminderList !== undefined ? pendingReminderList : currentReminderList;
        
        // Check if reminder list is valid (not empty, not course name, not placeholder)
        if (!reminderList || reminderList === courseName || reminderList === 'Enter reminder list name to enable') {
            // No reminder list set, prompt user to set it
            showSettingsWarning('Please set a reminder list name before enabling this course. Click on the reminder list name to edit it.');
            return;
        }
    }
    
    courseEnableDisableChanges[courseName] = newState;
    
    // Save immediately
    try {
        const endpoint = newState ? '/api/course-mapping/enable' : '/api/course-mapping/disable';
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ course_name: courseName })
        });
        
        const data = await response.json();
        if (data.success) {
            originalCourseStates[courseName] = newState;
        } else {
            // Revert on error
            courseEnableDisableChanges[courseName] = currentState;
            showSettingsWarning('Error updating course: ' + (data.error || 'Unknown error'), 'error');
            return;
        }
    } catch (error) {
        // Revert on error
        courseEnableDisableChanges[courseName] = currentState;
        showSettingsWarning('Error updating course: ' + error.message, 'error');
        return;
    }

    actionButton.className = newState ? 'btn-delete' : 'btn-enable';
    actionButton.textContent = newState ? 'Disable' : 'Enable';
    actionButton.title = newState ? 'Disable course' : 'Enable course';
    courseItem.className = `course-item ${!newState ? 'course-disabled' : ''}`;

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

async function syncAssignments() {
    const needsSetup = await checkSetupRequired();
    if (needsSetup) {
        showSetupModal();
        return;
    }

    if (activeAddReminderRequests > 0) {
        showStatus('Please wait for reminder addition to complete before syncing.', 'info');
        return;
    }
    if (activeAISummaryRequests > 0) {
        showStatus('Please wait for AI summary generation to finish before syncing.', 'info');
        return;
    }

    if (isAddAssignmentWorkflow) {
        showStatus('Please finish adding the assignment before syncing.', 'info');
        return;
    }

    if (isInsightsModalLoading) {
        showStatus('Please wait for AI insights to finish before syncing.', 'info');
        return;
    }

    await performSync();
}

async function checkSetupRequired() {
    if (!collegeName) {
        return true;
    }

    try {
        const response = await fetch('/api/courses');
        const data = await response.json();

        if (data.error || !Array.isArray(data)) {
            return false;
        }

        const coursesNeedingSetup = data.filter(course => {
            if (!course || !course.name) return false;
            const reminderList = course.reminder_list ? course.reminder_list.trim() : '';
            const hasReminderList = reminderList !== '';

            return !hasReminderList;
        });

        return coursesNeedingSetup.length > 0;
    } catch (error) {
        console.error('Error checking setup:', error);
        return false;
    }
}

function showSetupModal(showReminderListsMessage = false, assignmentIdForReminder = null, warningMessage = null, forceModal = false) {
    const modal = document.getElementById('setupModal');
    const collegeInput = document.getElementById('setupCollegeName');
    const autoSyncCheckbox = document.getElementById('setupAutoSyncReminders');
    const reminderListsGroup = document.getElementById('setupReminderListsGroup');
    const saveButton = document.getElementById('saveAndSync');
    const warningDiv = document.getElementById('setupWarningMessage');
    const cancelButton = document.getElementById('cancelSetup');

    isSetupModalForced = !!forceModal;
    if (cancelButton) {
        if (isSetupModalForced) {
            cancelButton.style.display = 'none';
            cancelButton.disabled = true;
        } else {
            cancelButton.style.display = 'inline-block';
            cancelButton.disabled = false;
        }
    }

    if (warningMessage) {
        warningDiv.textContent = warningMessage;
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }

    pendingReminderAssignmentId = assignmentIdForReminder || null;

    if (assignmentIdForReminder) {
        saveButton.textContent = 'Save & Add Reminder';
    } else {
        saveButton.textContent = 'Save & Sync';
    }

    if (collegeName) {
        collegeInput.value = collegeName;
    } else {
        collegeInput.value = '';
    }

    fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
            const autoSyncEnabled = data.auto_sync_reminders === '1' || data.auto_sync_reminders === true;
            autoSyncCheckbox.checked = autoSyncEnabled;

            const aiSummaryCheckbox = document.getElementById('setupAiSummaryEnabled');
            if (aiSummaryCheckbox) {
                const aiSummaryEnabled = data.ai_summary_enabled === '1';
                aiSummaryCheckbox.checked = aiSummaryEnabled;
            }

            reminderListsGroup.style.display = 'block';

            loadSetupCourses();
        })
        .catch(err => {
            console.error('Error loading settings:', err);
            autoSyncCheckbox.checked = false;
            const aiSummaryCheckbox = document.getElementById('setupAiSummaryEnabled');
            if (aiSummaryCheckbox) {
                aiSummaryCheckbox.checked = false;
            }
            reminderListsGroup.style.display = 'block';
            loadSetupCourses();
        });


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

        // Show all courses, not just those needing setup
        coursesList.innerHTML = '';
        data.forEach(course => {
            if (!course || !course.name) return;
            
            const isEnabled = course.enabled === true || course.enabled === 1 || course.enabled === '1';
            const defaultName = course.name ? course.name.trim() : '';
            let currentReminderList = '';
            
            // Only set reminder list if course is enabled
            if (isEnabled) {
                if (course.reminder_list && course.reminder_list.trim()) {
                    currentReminderList = course.reminder_list.trim();
                } else {
                    // For enabled courses without a reminder list, use course name as default
                    currentReminderList = defaultName;
                }
            }
            // For disabled courses, always leave empty (no value, no placeholder)
            
            const courseItem = document.createElement('div');
            courseItem.className = `course-item ${!isEnabled ? 'course-disabled' : ''}`;
            courseItem.style.marginBottom = '10px';
            courseItem.dataset.courseName = course.name;

            const courseInfo = document.createElement('div');
            courseInfo.className = 'course-info';
            courseInfo.style.flex = '1';

            const titleDiv = document.createElement('div');
            titleDiv.style.display = 'flex';
            titleDiv.style.alignItems = 'center';
            titleDiv.style.gap = '8px';
            titleDiv.style.marginBottom = '8px';
            
            const title = document.createElement('strong');
            title.textContent = course.name;
            titleDiv.appendChild(title);
            
            if (!isEnabled) {
                const disabledLabel = document.createElement('span');
                disabledLabel.className = 'disabled-label';
                disabledLabel.textContent = '(Disabled)';
                titleDiv.appendChild(disabledLabel);
            }
            
            courseInfo.appendChild(titleDiv);

            const inputDiv = document.createElement('div');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-input reminder-list-input';
            input.dataset.courseName = course.name;
            input.placeholder = isEnabled ? 'Enter reminder list name (required)' : 'Enter reminder list name to enable';
            // For disabled courses, always set value to empty string (no placeholder value)
            input.value = isEnabled ? currentReminderList : '';
            input.autocomplete = 'off';
            input.spellcheck = 'false';
            input.style.width = '100%';
            input.style.padding = '8px';
            input.style.border = '2px solid #e0e0e0';
            input.style.borderRadius = '6px';
            // Allow typing even when disabled so users can enter reminder list name
            input.disabled = false;
            
            if (!isEnabled) {
                input.style.opacity = '0.8';
                input.style.backgroundColor = '#fafafa';
            } else {
                input.style.opacity = '1';
                input.style.backgroundColor = '#ffffff';
            }
            
            // Input event listener is now added after actionButton creation
            inputDiv.appendChild(input);
            courseInfo.appendChild(inputDiv);

            const actionButton = document.createElement('button');
            actionButton.className = isEnabled ? 'btn-delete' : 'btn-enable';
            actionButton.textContent = isEnabled ? 'Disable' : 'Enable';
            actionButton.title = isEnabled ? 'Disable course' : 'Enable course';
            actionButton.dataset.courseName = course.name;
            actionButton.style.marginLeft = '12px';
            
            // Disable the Enable button if there's no reminder list name
            if (!isEnabled) {
                actionButton.disabled = !currentReminderList || currentReminderList.trim() === '';
                if (actionButton.disabled) {
                    actionButton.style.opacity = '0.5';
                    actionButton.style.cursor = 'not-allowed';
                    actionButton.title = 'Enter a reminder list name to enable';
                }
            }
            
            actionButton.addEventListener('click', () => {
                toggleSetupCourseEnabled(course.name, courseItem, actionButton, input);
            });
            
            // Update button state when input changes
            input.addEventListener('input', function() {
                // Check current disabled state dynamically
                const currentlyDisabled = courseItem.classList.contains('course-disabled');
                
                if (this.value.trim()) {
                    this.style.borderColor = '#4caf50';
                    // Enable the button if course is disabled
                    if (currentlyDisabled && actionButton.disabled) {
                        actionButton.disabled = false;
                        actionButton.style.opacity = '1';
                        actionButton.style.cursor = 'pointer';
                        actionButton.title = 'Enable course';
                    }
                } else {
                    this.style.borderColor = '#e0e0e0';
                    // Disable the button if course is disabled and no reminder list
                    if (currentlyDisabled) {
                        actionButton.disabled = true;
                        actionButton.style.opacity = '0.5';
                        actionButton.style.cursor = 'not-allowed';
                        actionButton.title = 'Enter a reminder list name to enable';
                    }
                }
            });

            courseItem.appendChild(courseInfo);
            courseItem.appendChild(actionButton);
            coursesList.appendChild(courseItem);
        });
    } catch (error) {
        console.error('Error loading setup courses:', error);
    }
}

function toggleSetupCourseEnabled(courseName, courseItem, actionButton, input) {
    const currentState = courseItem.classList.contains('course-disabled') ? false : true;
    const newState = !currentState;
    
    if (newState) {
        // Enabling - check if reminder list name is set
        const reminderList = input.value.trim();
        if (!reminderList) {
            showSetupWarning('Please enter a reminder list name before enabling this course.');
            input.focus();
            input.style.borderColor = '#d32f2f';
            return;
        }
    }
    
    // Update UI
    if (newState) {
        courseItem.classList.remove('course-disabled');
        actionButton.className = 'btn-delete';
        actionButton.textContent = 'Disable';
        actionButton.title = 'Disable course';
        actionButton.disabled = false;
        actionButton.style.opacity = '1';
        actionButton.style.cursor = 'pointer';
        input.style.opacity = '1';
        input.style.backgroundColor = '#ffffff';
        input.placeholder = 'Enter reminder list name (required)';
        
        // Remove disabled label if exists
        const disabledLabel = courseItem.querySelector('.disabled-label');
        if (disabledLabel) {
            disabledLabel.remove();
        }
    } else {
        courseItem.classList.add('course-disabled');
        actionButton.className = 'btn-enable';
        actionButton.textContent = 'Enable';
        // Keep input enabled so user can type reminder list name
        input.style.opacity = '0.8';
        input.style.backgroundColor = '#fafafa';
        input.placeholder = 'Enter reminder list name to enable';
        input.style.borderColor = '#e0e0e0';
        // Clear the value when disabling
        input.value = '';
        
        // Disable the Enable button if there's no reminder list name
        const reminderList = input.value.trim();
        actionButton.disabled = !reminderList || reminderList === '';
        if (actionButton.disabled) {
            actionButton.style.opacity = '0.5';
            actionButton.style.cursor = 'not-allowed';
            actionButton.title = 'Enter a reminder list name to enable';
        } else {
            actionButton.style.opacity = '1';
            actionButton.style.cursor = 'pointer';
            actionButton.title = 'Enable course';
        }
        
        // Add disabled label
        const titleDiv = courseItem.querySelector('.course-info > div');
        if (titleDiv && !titleDiv.querySelector('.disabled-label')) {
            const disabledLabel = document.createElement('span');
            disabledLabel.className = 'disabled-label';
            disabledLabel.textContent = '(Disabled)';
            titleDiv.appendChild(disabledLabel);
        }
    }
}

function showSetupWarning(message) {
    const warningDiv = document.getElementById('setupWarningMessage');
    if (warningDiv) {
        warningDiv.textContent = message;
        warningDiv.style.display = 'block';
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';
        warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function performSync() {
    const btn = document.getElementById('syncBtn');
    const aiInsightsBtn = document.getElementById('aiInsightsBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const progressContainer = document.getElementById('syncProgress');
    const progressCount = document.getElementById('syncProgressCount');
    const progressTime = document.getElementById('syncProgressTime');
    const progressText = document.getElementById('syncProgressText');
    const progressBar = document.getElementById('syncProgressBar');

    isSyncInProgress = true;
    btn.textContent = 'Syncing...';
    refreshPrimaryButtonsState();
    updateAddAssignmentButtonsState();
    // Settings button is now in sidebar, no need to disable it during sync

    const restoreAfterSync = () => {
        isSyncInProgress = false;
        btn.textContent = 'Sync Assignments';
        refreshPrimaryButtonsState();
        updateAddAssignmentButtonsState();
        // Settings button is now in sidebar, no need to re-enable it
    };

    progressContainer.style.display = 'block';
    progressCount.textContent = '';
    progressTime.textContent = '';
    progressText.textContent = 'Starting sync...';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '';

    try {
        const eventSource = new EventSource('/api/sync?ai_enabled=true');

        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'progress') {
                    progressBar.style.width = data.progress + '%';
                    progressText.textContent = data.message || 'Syncing...';

                    if (data.assignment_count !== undefined) {
                        progressCount.textContent = `${data.assignment_count} assignment${data.assignment_count !== 1 ? 's' : ''} found`;
                    }

                    progressTime.textContent = '';

                    if (data.assignment) {
                        const existingIndex = assignments.findIndex(a => a.assignment_id === data.assignment.assignment_id);
                        if (existingIndex === -1) {
                            assignments.push(data.assignment);

                            assignments.sort((a, b) => {
                                if (!a.due_at && !b.due_at) return 0;
                                if (!a.due_at) return 1;
                                if (!b.due_at) return -1;
                                return new Date(a.due_at) - new Date(b.due_at);
                            });

                            filterAssignments();
                            updateStats();
                        }
                    }
                } else if (data.type === 'complete') {
                    eventSource.close();
                    progressBar.style.width = '100%';

                    if (data.total_added > 0) {
                        showStatus(`Successfully synced ${data.total_added} new assignments!`, 'success');
                    } else {
                        showStatus('No new assignments to add. You\'re all caught up!', 'info');
                    }

                    progressContainer.style.display = 'none';

                    await loadAssignments();
                    await loadCourses();
                    const settingsModal = document.getElementById('settingsModal');
                    if (settingsModal.style.display === 'block') {
                        await loadCoursesInSettings();
                    }

                    const needsSetup = await checkSetupRequired();
                    if (needsSetup) {
                        setTimeout(() => {
                            showSetupModal(false, null, 'New courses detected! Please set reminder list names for all courses below.');
                        }, 2000);
                    }

                    restoreAfterSync();
                } else if (data.type === 'error') {
                    eventSource.close();
                    showStatus('Error: ' + data.error, 'error');
                    progressText.textContent = 'Error: ' + data.error;
                    progressBar.style.width = '100%';
                    progressBar.style.backgroundColor = '#d32f2f';
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 5000);
                    restoreAfterSync();
                }
            } catch (parseError) {
                console.error('Error parsing SSE data:', parseError);
                restoreAfterSync();
            }
        };

        eventSource.onerror = (error) => {
            eventSource.close();
            showStatus('Error syncing: Connection error', 'error');
            progressText.textContent = 'Connection error occurred';
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = '#d32f2f';
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 5000);
            restoreAfterSync();
        };

    } catch (error) {
        showStatus('Error syncing: ' + error.message, 'error');
        progressText.textContent = 'Error: ' + error.message;
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#d32f2f';
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 5000);
        restoreAfterSync();
    }
}

async function saveAndSync() {
    const collegeInput = document.getElementById('setupCollegeName');
    const autoSyncCheckbox = document.getElementById('setupAutoSyncReminders');
    const warningDiv = document.getElementById('setupWarningMessage');
    const newCollegeName = (collegeInput.value || '').trim();

    if (!newCollegeName) {
        warningDiv.textContent = 'Please select or enter your college or university name.';
        warningDiv.style.display = 'block';
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';
        collegeInput.focus();
        collegeInput.style.borderColor = '#d32f2f';

        warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    const autoSyncEnabled = autoSyncCheckbox.checked;
    const aiSummaryCheckbox = document.getElementById('setupAiSummaryEnabled');
    const aiSummaryEnabled = aiSummaryCheckbox ? aiSummaryCheckbox.checked : false;

    const reminderListInputs = document.querySelectorAll('.reminder-list-input');
    const coursesToUpdate = [];
    const coursesToDisable = [];
    const missingCourses = [];

    reminderListInputs.forEach(input => {
        const courseName = input.dataset.courseName;
        const reminderList = input.value.trim();
        const courseItem = input.closest('.course-item');
        const isEnabled = !courseItem.classList.contains('course-disabled');

        if (isEnabled) {
            // For enabled courses, reminder list is required
            if (!reminderList) {
                missingCourses.push(courseName);
                input.style.borderColor = '#d32f2f';

                if (missingCourses.length === 1) {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    input.focus();
                }
            } else {
                input.style.borderColor = '#4caf50';
                coursesToUpdate.push({ course_name: courseName, reminder_list: reminderList, enabled: true });
            }
        } else {
            // For disabled courses, save as disabled (reminder list optional)
            coursesToDisable.push(courseName);
            if (reminderList) {
                // Save reminder list even if disabled (for future enable)
                coursesToUpdate.push({ course_name: courseName, reminder_list: reminderList, enabled: false });
            }
        }
    });

    if (missingCourses.length > 0) {
        const courseList = missingCourses.length <= 3
            ? missingCourses.join(', ')
            : `${missingCourses.slice(0, 3).join(', ')} and ${missingCourses.length - 3} more`;
        warningDiv.textContent = `Please fill in reminder list names for enabled courses: ${courseList}`;
        warningDiv.style.display = 'block';
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';

        warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    warningDiv.style.display = 'none';
    try {
        const settingsResponse = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                college_name: newCollegeName,
                auto_sync_reminders: autoSyncEnabled ? '1' : '0',
                ai_summary_enabled: aiSummaryEnabled ? '1' : '0'
            })
        });

        const settingsData = await settingsResponse.json();
        if (!settingsData.success) {
            showStatus('Error saving settings: ' + (settingsData.error || 'Unknown error'), 'error');
            return;
        }

        collegeName = newCollegeName;

        // Save enabled courses with reminder lists
        for (const course of coursesToUpdate) {
            await fetch('/api/course-mapping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    course_name: course.course_name,
                    reminder_list: course.reminder_list
                })
            });
            
            // Set enabled state
            if (course.enabled) {
                await fetch('/api/course-mapping/enable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course_name: course.course_name })
                });
            } else {
                await fetch('/api/course-mapping/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course_name: course.course_name })
                });
            }
        }
        
        // Disable courses that were marked as disabled
        for (const courseName of coursesToDisable) {
            // Only disable if not already in coursesToUpdate
            const alreadyHandled = coursesToUpdate.some(c => c.course_name === courseName);
            if (!alreadyHandled) {
                await fetch('/api/course-mapping/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course_name: courseName })
                });
            }
        }

        await loadAssignments();
        await loadCourses();
        populateSidebarCourses();

        closeSetupModal();

        if (pendingReminderAssignmentId) {
            const assignmentId = pendingReminderAssignmentId;
            pendingReminderAssignmentId = null;

            const button = document.querySelector(`.btn-add-reminder[data-assignment-id="${assignmentId}"]`);
            if (button) {
                await addReminder(assignmentId, button);
            } else {
                showStatus('Please click "Add to Reminders" again now that reminder lists are set.', 'info');
            }
        }
        
        // Always trigger sync after saving settings
        await performSync();

    } catch (error) {
        showStatus('Error saving setup: ' + error.message, 'error');
    }
}

function closeSetupModal() {
    const modal = document.getElementById('setupModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    isSetupModalForced = false;
}

async function saveSettings() {
    const input = document.getElementById('collegeName');
    const autoSyncCheckbox = document.getElementById('settingsAutoSyncReminders');
    const warningDiv = document.getElementById('settingsWarningMessage');

    const newCollegeName = (input.value || '').trim();

    if (!newCollegeName) {
        showSettingsWarning('Please select or enter your college or university name.', 'error');
        input.focus();
        input.style.borderColor = '#d32f2f';
        return;
    }

    warningDiv.style.display = 'none';
    const autoSyncEnabled = autoSyncCheckbox ? autoSyncCheckbox.checked : false;
    const aiSummaryCheckbox = document.getElementById('settingsAiSummaryEnabled');
    const aiSummaryEnabled = aiSummaryCheckbox ? aiSummaryCheckbox.checked : true;
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                college_name: newCollegeName,
                auto_sync_reminders: autoSyncEnabled ? '1' : '0',
                ai_summary_enabled: aiSummaryEnabled ? '1' : '0'
            })
        });

        const data = await response.json();
        if (data.success) {
            collegeName = newCollegeName;

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

            courseEnableDisableChanges = {};

            // Save reminder list changes
            for (const [courseName, reminderList] of Object.entries(reminderListChanges)) {
                try {
                    await fetch('/api/course-mapping', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            course_name: courseName,
                            reminder_list: reminderList
                        })
                    });
                    // Update existing assignments for this course
                    try {
                        await bulkUpdateReminderListForCourse(courseName, reminderList);
                    } catch (_) {}
                } catch (error) {
                    console.error(`Error updating reminder list for ${courseName}:`, error);
                }
            }

            reminderListChanges = {};

            showSettingsWarning('Settings saved!', 'success');
            await loadAssignments();
            await loadCoursesInSettings();
            await loadCourses();
            
            // Close modal after a brief delay to show success message
            setTimeout(() => {
                closeModal();
            }, 1000);
            const status = document.getElementById('status');
            if (status.className.includes('warning')) {
                status.style.display = 'none';
            }
        }
    } catch (error) {
        showSettingsWarning('Error saving settings: ' + error.message, 'error');
    }
}

function showSettingsWarning(message, type = 'info') {
    const warningDiv = document.getElementById('settingsWarningMessage');
    if (!warningDiv) return;
    
    warningDiv.textContent = message;
    warningDiv.style.display = 'block';
    
    if (type === 'error') {
        warningDiv.style.background = '#f8d7da';
        warningDiv.style.borderColor = '#d32f2f';
        warningDiv.style.color = '#721c24';
        // Auto-dismiss error messages after 5 seconds
        setTimeout(() => {
            if (warningDiv.textContent === message) {
                warningDiv.style.display = 'none';
            }
        }, 5000);
    } else if (type === 'info') {
        warningDiv.style.background = '#d1ecf1';
        warningDiv.style.borderColor = '#0c5460';
        warningDiv.style.color = '#0c5460';
    } else if (type === 'success') {
        warningDiv.style.background = '#d4edda';
        warningDiv.style.borderColor = '#28a745';
        warningDiv.style.color = '#155724';
        // Auto-dismiss success messages after 3 seconds
        setTimeout(() => {
            if (warningDiv.textContent === message) {
                warningDiv.style.display = 'none';
            }
        }, 3000);
    }
    
    warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function editManualCourseName(courseName, currentName) {
    // For manually added courses, name and reminder list are the same
    const newName = prompt(`Rename course:`, currentName);
    if (newName === null) return;

    const trimmed = newName.trim();
    if (!trimmed) {
        showSettingsWarning('Course name cannot be empty.', 'error');
        return;
    }
    
    if (trimmed === currentName) {
        // No change
        return;
    }

    // Save immediately - update both course name and reminder list
    try {
        if (trimmed === courseName) {
            // Only updating reminder list, not renaming course
            const response = await fetch('/api/course-mapping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    course_name: courseName,
                    reminder_list: trimmed
                })
            });

            const data = await response.json();
            if (data.success) {
                // Update all assignments with the new reminder list
                try {
                    await bulkUpdateReminderListForCourse(courseName, trimmed);
                } catch (_) {}
                
                // Reload courses and assignments
                await loadCourses();
                await loadAssignments();
                await loadCoursesInSettings();
                populateSidebarCourses();
                showSettingsWarning('Course updated successfully', 'success');
            } else {
                showSettingsWarning('Error updating course: ' + (data.error || 'Unknown error'), 'error');
            }
        } else {
            // Renaming course - need to update course name and all assignments
            // First, create new course mapping with new name
            const response = await fetch('/api/course-mapping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    course_name: trimmed,
                    reminder_list: trimmed
                })
            });

            const data = await response.json();
            if (data.success) {
                // Update all assignments with the new course name
                try {
                    const assignmentsResp = await fetch('/api/assignments');
                    const assignmentsData = await assignmentsResp.json();
                    if (Array.isArray(assignmentsData)) {
                        const assignmentsToUpdate = assignmentsData.filter(a => a && a.course_name === courseName);
                        if (assignmentsToUpdate.length > 0) {
                            const ids = assignmentsToUpdate.map(a => a.assignment_id);
                            await fetch('/api/assignments/bulk-update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    assignment_ids: ids,
                                    updates: {
                                        course_name: trimmed,
                                        reminder_list: trimmed
                                    }
                                })
                            });
                        }
                    }
                } catch (_) {}
                
                // Delete old course mapping
                try {
                    await fetch('/api/course-mapping/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ course_name: courseName })
                    });
                } catch (_) {}
                
                // Reload courses and assignments
                await loadCourses();
                await loadAssignments();
                await loadCoursesInSettings();
                populateSidebarCourses();
                showSettingsWarning('Course renamed successfully', 'success');
            } else {
                showSettingsWarning('Error renaming course: ' + (data.error || 'Unknown error'), 'error');
            }
        }
    } catch (error) {
        showSettingsWarning('Error updating course: ' + error.message, 'error');
    }
}

async function deleteManualCourse(courseName) {
    if (!confirm(`Are you sure you want to delete "${courseName}"? This will also delete all assignments for this course.`)) {
        return;
    }

    try {
        const response = await fetch('/api/course-mapping/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ course_name: courseName })
        });

        const data = await response.json();
        if (data.success) {
            // Delete all assignments for this course
            try {
                const assignmentsResp = await fetch('/api/assignments');
                const assignmentsData = await assignmentsResp.json();
                if (Array.isArray(assignmentsData)) {
                    const assignmentsToDelete = assignmentsData.filter(a => a && a.course_name === courseName);
                    for (const assignment of assignmentsToDelete) {
                        await fetch('/api/assignments/permanently-delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ assignment_id: assignment.assignment_id })
                        });
                    }
                }
            } catch (_) {}
            
            // Reload courses and assignments
            await loadCourses();
            await loadAssignments();
            await loadCoursesInSettings();
            populateSidebarCourses();
        } else {
            showSettingsWarning('Error deleting course: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showSettingsWarning('Error deleting course: ' + error.message, 'error');
    }
}

async function editReminderList(courseName, currentReminderList) {
    // Get the current value (either pending change or original)
    const displayValue = reminderListChanges[courseName] !== undefined 
        ? reminderListChanges[courseName] 
        : (currentReminderList || '');
    
    const newReminderList = prompt(`Enter reminder list name for "${courseName}":`, displayValue);
    if (newReminderList === null) return;

    const trimmed = newReminderList.trim();
    if (!trimmed) {
        showSettingsWarning('Reminder list name cannot be empty.', 'error');
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            const warningDiv = document.getElementById('settingsWarningMessage');
            if (warningDiv) {
                warningDiv.style.display = 'none';
            }
        }, 3000);
        return;
    }

    // Save immediately
    try {
        const response = await fetch('/api/course-mapping', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                course_name: courseName,
                reminder_list: trimmed
            })
        });

        const data = await response.json();
        if (data.success) {
            // Update existing assignments for this course
            try {
                await bulkUpdateReminderListForCourse(courseName, trimmed);
            } catch (_) {}
            
            // Update the display immediately
            const reminderSpan = document.querySelector(`.reminder-list-editable[data-course-name="${escapeHtml(courseName)}"]`);
            if (reminderSpan) {
                reminderSpan.textContent = trimmed;
                reminderSpan.dataset.reminderList = trimmed;
                reminderSpan.style.color = '#667eea';
                reminderSpan.style.fontStyle = 'normal';
                
                // Update Enable button state if course is disabled
                const courseItem = reminderSpan.closest('.course-item');
                if (courseItem && courseItem.classList.contains('course-disabled')) {
                    const enableButton = courseItem.querySelector('.btn-enable');
                    if (enableButton) {
                        enableButton.disabled = false;
                        enableButton.style.opacity = '1';
                        enableButton.style.cursor = 'pointer';
                        enableButton.title = 'Enable course';
                    }
                }
            }
            
            // Remove from pending changes since it's saved
            delete reminderListChanges[courseName];
        } else {
            showSettingsWarning('Error saving reminder list: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showSettingsWarning('Error saving reminder list: ' + error.message, 'error');
    }
}

async function bulkUpdateReminderListForCourse(courseName, newReminderList) {
    const ids = assignments
        .filter(a => a && a.course_name === courseName)
        .map(a => a.assignment_id);
    if (!ids || ids.length === 0) {
        return;
    }
    const res = await fetch('/api/assignments/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignment_ids: ids, fields: { reminder_list: newReminderList } })
    });
    const data = await res.json();
    if (!data.success) {
        console.error('Failed to update assignments:', data.error);
        // Don't show error to user - mapping was saved successfully
    }
}

async function openSettings() {
    if (activeAISummaryRequests > 0 || isAddAssignmentWorkflow || isSyncInProgress || isInsightsModalLoading || activeAddReminderRequests > 0) {
        showStatus('Please wait for current operation to finish before opening Settings.', 'info');
        return;
    }
    const modal = document.getElementById('settingsModal');
    courseEnableDisableChanges = {};
    reminderListChanges = {};
    originalCourseStates = {};
    await loadSettings({ suppressSetupCheck: true });

    const warningDiv = document.getElementById('settingsWarningMessage');
    if (warningDiv) {
        warningDiv.style.display = 'none';
    }
    modal.style.display = 'block';

    document.body.style.overflow = 'hidden';
}

async function closeModal() {
    const modal = document.getElementById('settingsModal');
    
    // Save college name, auto sync, and AI summary settings before closing
    const input = document.getElementById('collegeName');
    const autoSyncCheckbox = document.getElementById('settingsAutoSyncReminders');
    const aiSummaryCheckbox = document.getElementById('settingsAiSummaryEnabled');
    
    if (input && autoSyncCheckbox && aiSummaryCheckbox) {
        const newCollegeName = (input.value || '').trim();
        const autoSyncEnabled = autoSyncCheckbox.checked;
        const aiSummaryEnabled = aiSummaryCheckbox ? aiSummaryCheckbox.checked : true;
        
        // Only save if college name is provided
        if (newCollegeName) {
            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        college_name: newCollegeName,
                        auto_sync_reminders: autoSyncEnabled ? '1' : '0',
                        ai_summary_enabled: aiSummaryEnabled ? '1' : '0'
                    })
                });
                collegeName = newCollegeName;
            } catch (error) {
                console.error('Error saving settings on close:', error);
            }
        }
    }
    
    courseEnableDisableChanges = {};
    reminderListChanges = {};
    originalCourseStates = {};
    const warningDiv = document.getElementById('settingsWarningMessage');
    if (warningDiv) {
        warningDiv.style.display = 'none';
    }
    modal.style.display = 'none';
    document.body.style.overflow = '';
}
window.onclick = function(event) {
    const completedModal = document.getElementById('completedModal');
    const deletedModal = document.getElementById('deletedModal');
    const aiInsightsModal = document.getElementById('aiInsightsModal');
    const addAssignmentModal = document.getElementById('addAssignmentModal');
    const settingsModal = document.getElementById('settingsModal');

    if (event.target === completedModal) {
        closeCompletedModal();
    }
    if (event.target === deletedModal) {
        closeDeletedModal();
    }
    if (event.target === aiInsightsModal) {
        closeAIInsightsModal();
    }
    if (event.target === settingsModal) {
        closeModal();
    }
}

function displayAssignments(assignmentsToShow) {
    const container = document.getElementById('assignmentsList');
    const completedSection = document.getElementById('completedAssignmentsSection');

    // Hide the completed section
    if (completedSection) {
        completedSection.style.display = 'none';
    }
    
    // Hide completed status
    const completedStatus = document.getElementById('completedStatus');
    if (completedStatus) {
        completedStatus.style.display = 'none';
    }

    let allAssignments = [...assignmentsToShow];

    if (allAssignments.length === 0 && currentFilter !== 'all') {
        // For single course view with no assignments, still show the add assignment button
        if (currentFilterCourse) {
            // Get display name from courses list
            const course = courses.find(c => (c.name || c.course_name) === currentFilterCourse);
            const displayCourseName = course 
                ? ((course.reminder_list && course.reminder_list.trim()) 
                    ? course.reminder_list.trim() 
                    : (course.name || course.course_name))
                : currentFilterCourse;
            const safeFormId = currentFilterCourse.replace(/[^a-zA-Z0-9_-]/g, '_');
            container.innerHTML = `
                <div class="add-assignment-hint" ondblclick="showInlineAssignmentForm('${escapeHtml(currentFilterCourse)}', '${escapeHtml(displayCourseName)}')" onclick="showInlineAssignmentForm('${escapeHtml(currentFilterCourse)}', '${escapeHtml(displayCourseName)}')" title="Double-click or click to add assignment">
                    <span class="add-assignment-icon">+</span>
                    <span class="add-assignment-text">Add assignment</span>
                </div>
                <div class="inline-assignment-form" id="inline-form-${safeFormId}" style="display: none;"></div>
            `;
            container.classList.add('single-course-view');
            updateAddAssignmentButtonsState();
            const statusEl = document.getElementById('status');
            const syncProgressEl = document.getElementById('syncProgress');
            if (statusEl) statusEl.classList.add('single-course-view');
            if (syncProgressEl) syncProgressEl.classList.add('single-course-view');
        } else {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No assignments found.</p>';
        }
    } else {
        // Group by class if viewing "All Classes"
        if (currentFilter === 'all') {
            const grouped = {};
            
            // First, add all courses from the courses list (including manually added ones with no assignments)
            courses.forEach(c => {
                if (c && (c.name || c.course_name) && (c.enabled === true || c.enabled === 1 || c.enabled === '1')) {
                    const courseName = c.name || c.course_name;
                    const displayName = (c.reminder_list && c.reminder_list.trim()) 
                        ? c.reminder_list.trim() 
                        : courseName;
                    if (!grouped[displayName]) {
                        grouped[displayName] = {
                            assignments: [],
                            officialCourseName: courseName
                        };
                    }
                }
            });
            
            // Then, add assignments to their respective courses
            allAssignments.forEach(assignment => {
                const displayCourseName = (assignment.reminder_list && assignment.reminder_list.trim()) 
                    ? assignment.reminder_list.trim() 
                    : (assignment.course_name || 'Unknown Course');
                if (!grouped[displayCourseName]) {
                    grouped[displayCourseName] = {
                        assignments: [],
                        officialCourseName: assignment.course_name
                    };
                }
                grouped[displayCourseName].assignments.push(assignment);
            });
            
            // Sort courses alphabetically and assignments by due date within each course
            const sortedCourses = Object.keys(grouped).sort();
            
            let html = '';
            sortedCourses.forEach(courseName => {
                const courseData = grouped[courseName];
                const officialCourseName = courseData.officialCourseName;
                
                // Sort assignments by due date
                courseData.assignments.sort((a, b) => {
                    if (!a.due_at && !b.due_at) return 0;
                    if (!a.due_at) return 1;
                    if (!b.due_at) return -1;
                    return new Date(a.due_at) - new Date(b.due_at);
                });
                
                const safeFormId = officialCourseName.replace(/[^a-zA-Z0-9_-]/g, '_');
                html += `<div class="course-group-section" data-course-name="${escapeHtml(officialCourseName)}">
                    <div class="course-group-header">${escapeHtml(courseName)}</div>
                    <div class="course-group-assignments">
                        ${courseData.assignments.map(assignment => createAssignmentCard(assignment)).join('')}
                        <div class="add-assignment-hint" ondblclick="showInlineAssignmentForm('${escapeHtml(officialCourseName)}', '${escapeHtml(courseName)}')" onclick="showInlineAssignmentForm('${escapeHtml(officialCourseName)}', '${escapeHtml(courseName)}')" title="Double-click or click to add assignment">
                            <span class="add-assignment-icon">+</span>
                            <span class="add-assignment-text">Add assignment</span>
                        </div>
                        <div class="inline-assignment-form" id="inline-form-${safeFormId}" style="display: none;"></div>
                    </div>
                </div>`;
            });
            container.innerHTML = html;
            container.classList.remove('single-course-view');
            updateAddAssignmentButtonsState();
            // Remove spacing class from status and sync progress for "All Classes" view
            const statusEl = document.getElementById('status');
            const syncProgressEl = document.getElementById('syncProgress');
            if (statusEl) statusEl.classList.remove('single-course-view');
            if (syncProgressEl) syncProgressEl.classList.remove('single-course-view');
        } else {
            let html = allAssignments.map((assignment) => {
                return createAssignmentCard(assignment);
            }).join('');
            // Add inline form at the bottom for single course view
            if (currentFilterCourse) {
                const displayCourseName = allAssignments.length > 0 
                    ? ((allAssignments[0].reminder_list && allAssignments[0].reminder_list.trim()) 
                        ? allAssignments[0].reminder_list.trim() 
                        : allAssignments[0].course_name)
                    : currentFilterCourse;
                const safeFormId = currentFilterCourse.replace(/[^a-zA-Z0-9_-]/g, '_');
                html += `<div class="add-assignment-hint" ondblclick="showInlineAssignmentForm('${escapeHtml(currentFilterCourse)}', '${escapeHtml(displayCourseName)}')" onclick="showInlineAssignmentForm('${escapeHtml(currentFilterCourse)}', '${escapeHtml(displayCourseName)}')" title="Double-click or click to add assignment">
                    <span class="add-assignment-icon">+</span>
                    <span class="add-assignment-text">Add assignment</span>
                </div>`;
                html += `<div class="inline-assignment-form" id="inline-form-${safeFormId}" style="display: none;"></div>`;
            }
            container.innerHTML = html;
            container.classList.add('single-course-view');
            updateAddAssignmentButtonsState();
            // Add spacing class to status and sync progress for specific class view
            const statusEl = document.getElementById('status');
            const syncProgressEl = document.getElementById('syncProgress');
            if (statusEl) statusEl.classList.add('single-course-view');
            if (syncProgressEl) syncProgressEl.classList.add('single-course-view');
        }
    }
}

function createAssignmentCard(assignment) {
    let title = assignment.title || '';
    if (title) {
        const tmp = document.createElement('div');
        tmp.innerHTML = title;
        title = tmp.textContent || tmp.innerText || '';
    }

    if (!title.trim()) {
        title = 'Untitled Assignment';
    }

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

    // Use reminder_list for display, fallback to course_name if not set
    const displayCourseName = (assignment.reminder_list && assignment.reminder_list.trim()) 
        ? assignment.reminder_list.trim() 
        : (assignment.course_name || 'Unknown Course');
    const courseName = assignment.course_name || 'Unknown Course'; // Keep for AI calls

    let aiNotes = '';
    if (assignment.ai_notes && assignment.ai_notes.trim()) {
        const tmp = document.createElement('div');
        tmp.innerHTML = assignment.ai_notes;
        aiNotes = tmp.textContent || tmp.innerText || '';
    }

    const aiConfidence = assignment.ai_confidence || null;
    const aiConfidenceExplanation = assignment.ai_confidence_explanation || null;
    let confidenceStars = '';
    if (aiConfidence !== null && aiConfidence !== undefined) {
        let tooltipText = `AI Confidence: ${aiConfidence}/5`;
        if (aiConfidenceExplanation) {
            tooltipText += `\n\n${escapeHtml(aiConfidenceExplanation)}`;
        }
        confidenceStars = `<span class="ai-confidence" style="display: inline-flex; align-items: center; gap: 4px; margin-left: 12px; color: var(--text-secondary); font-size: 0.85em; cursor: help;" title="${tooltipText}"><span style="opacity: 0.7;">AI Confidence:</span><span style="font-weight: 600;">${aiConfidence}/5</span></span>`;
    }

    const aiNotesSection = aiNotes ?
        `<div class="assignment-ai-notes">
            <div style="display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 0;">
                <strong>AI Summary:</strong>${confidenceStars}
            </div>
            <div style="margin: 0; padding: 0;">${escapeHtml(aiNotes)}</div>
        </div>` : '';

    const status = assignment.status || 'Not Started';

    return `
        <div class="assignment-card" data-assignment-id="${escapeHtml(assignment.assignment_id)}" 
             oncontextmenu="event.preventDefault(); showContextMenu(event, '${escapeHtml(assignment.assignment_id)}')"
             tabindex="0"
             onfocus="focusedAssignmentId = '${escapeHtml(assignment.assignment_id)}'"
             onblur="focusedAssignmentId = null">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div style="display: flex; align-items: center; padding-top: 2px;">
                    <input type="checkbox" class="assignment-checkbox" ${assignment.deleted ? 'checked' : ''}
                           onchange="event.stopPropagation(); toggleAssignmentDeleted('${escapeHtml(assignment.assignment_id)}', this.checked)">
                </div>
                <div style="flex: 1; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; min-width: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="assignment-title">${escapeHtml(title)}</div>
                        <div class="assignment-due" style="margin-top: 4px;">${escapeHtml(formattedDate)}</div>
                        ${assignment.deleted ? `
                            <div class="assignment-meta" style="margin-top: 8px;">
                                <button type="button" onclick="restoreAssignment('${escapeHtml(assignment.assignment_id)}')"
                                        style="background: none; border: none; color: #4caf50; cursor: pointer; font-size: 0.9em; padding: 2px 6px; opacity: 0.7; transition: opacity 0.2s;"
                                        onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"
                                        title="Restore assignment">Restore</button>
                                <button type="button" onclick="permanentlyDeleteAssignment('${escapeHtml(assignment.assignment_id)}')"
                                        style="background: none; border: none; color: #d32f2f; cursor: pointer; font-size: 0.9em; padding: 2px 6px; opacity: 0.7; transition: opacity 0.2s;"
                                        onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"
                                        title="Delete forever">Delete Forever</button>
                            </div>
                        ` : ''}
                        ${aiNotesSection}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; align-items: flex-end; padding-top: 2px;">
                        ${assignment.reminder_added === 1 || assignment.reminder_added === true
                            ? `<button type="button" class="btn-reminder-link btn-remove-reminder" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Remove from Reminders</button>`
                            : `<button type="button" class="btn-reminder-link btn-add-reminder" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Add to Reminders</button>`
                        }
                        ${aiNotes && aiNotes.trim()
                            ? `<button type="button" class="btn-reminder-link btn-remove-ai-summary" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Remove AI Summary</button>`
                            : `<button type="button" class="btn-reminder-link btn-generate-ai-summary" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Generate AI Summary</button>`
                        }
                    </div>
                </div>
            </div>
        </div>
    `;
}


function toggleAssignmentDeleted(assignmentId, checked) {
    if (checked) {
        deleteAssignment(assignmentId);
    } else {
        restoreAssignment(assignmentId);
    }
}

function filterAssignments() {
    let filtered = assignments.filter(a => {
        if (!a) return false;
        
        // Apply filter based on current view
        if (currentFilter === 'deleted') {
            return a.deleted === true;
        } else if (currentFilter === 'course' && currentFilterCourse) {
            return !a.deleted && a.course_name === currentFilterCourse;
        } else {
            // 'all' - show all non-deleted assignments
            if (a.deleted) return false;
            return true;
        }
    });

    filtered.sort((a, b) => {
        if (!a.due_at && !b.due_at) return 0;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return new Date(a.due_at) - new Date(b.due_at);
    });

    displayAssignments(filtered);
    updateStats(filtered);

    attachReminderListeners();
    attachAISummaryListeners();
    updateAssignmentActionButtonsState();
}

function attachReminderListeners() {
    const assignmentsList = document.getElementById('assignmentsList');
    if (!assignmentsList) return;

    assignmentsList.removeEventListener('click', handleReminderButtonClick);
    assignmentsList.addEventListener('click', handleReminderButtonClick);
}

function attachAISummaryListeners() {
    const assignmentsList = document.getElementById('assignmentsList');
    if (!assignmentsList) return;

    assignmentsList.removeEventListener('click', handleAISummaryButtonClick);
    assignmentsList.addEventListener('click', handleAISummaryButtonClick);
}

function handleReminderButtonClick(e) {
    const addButton = e.target.closest('.btn-add-reminder');
    const removeButton = e.target.closest('.btn-remove-reminder');
    
    if (!addButton && !removeButton) return;
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    if (removeButton) {
        const assignmentId = removeButton.dataset.assignmentId;
        if (assignmentId) {
            removeReminder(assignmentId, removeButton);
        }
        return false;
    }
    
    if (addButton) {
        if (activeAddReminderRequests > 0) {
            showStatus('A reminder is currently being added. Please wait...', 'info');
            return false;
        }
        if (isSyncInProgress) {
            showStatus('Please wait for sync to finish before adding reminders.', 'info');
            return false;
        }
        if (isInsightsModalLoading) {
            showStatus('Please wait for AI insights to finish before adding reminders.', 'info');
            return false;
        }
        if (activeAISummaryRequests > 0) {
            showStatus('Please wait for AI summary generation to finish before adding reminders.', 'info');
            return false;
        }
        if (isAddAssignmentWorkflow) {
            showStatus('Please finish adding the assignment before adding reminders.', 'info');
            return false;
        }

        const assignmentId = addButton.dataset.assignmentId;
        if (assignmentId) {
            addReminder(assignmentId, addButton);
        }
        return false;
    }
}

function handleAISummaryButtonClick(e) {
    const generateButton = e.target.closest('.btn-generate-ai-summary');
    const removeButton = e.target.closest('.btn-remove-ai-summary');
    
    if (!generateButton && !removeButton) return;
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    if (removeButton) {
        const assignmentId = removeButton.dataset.assignmentId;
        if (assignmentId) {
            removeAISummary(assignmentId, removeButton);
        }
        return false;
    }
    
    if (generateButton) {
        if (isSyncInProgress) {
            showStatus('Please wait for sync to finish before generating summaries.', 'info');
            return false;
        }
        if (isInsightsModalLoading) {
            showStatus('Please wait for AI insights to finish before generating summaries.', 'info');
            return false;
        }
        if (activeAISummaryRequests > 0) {
            showStatus('Another AI summary is generating. Please wait...', 'info');
            return false;
        }
        if (isAddAssignmentWorkflow) {
            showStatus('Please finish adding the assignment before generating summaries.', 'info');
            return false;
        }

        const assignmentId = generateButton.dataset.assignmentId;
        if (assignmentId) {
            generateAISummary(assignmentId, generateButton);
        }
        return false;
    }
}

async function generateAISummary(assignmentId, buttonElement) {
    let stateUpdated = false;
    try {
        const assignment = assignments.find(a => a.assignment_id === assignmentId);
        if (!assignment) {
            showStatus('Assignment not found.', 'error');
            return;
        }

        activeAISummaryRequests += 1;
        stateUpdated = true;
        refreshPrimaryButtonsState();

        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.textContent = 'Generating...';
        }

        const response = await fetch('/api/assignments/generate-ai-summary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.error) {
            showStatus('Error generating AI summary: ' + data.error, 'error');
            buttonElement.disabled = false;
            buttonElement.textContent = 'Generate AI Summary';
        } else {
            showStatus('AI summary generated successfully!', 'success');

            if (buttonElement) {
                buttonElement.classList.remove('btn-generate-ai-summary');
                buttonElement.classList.add('btn-ai-summary-added');
                buttonElement.textContent = 'Generated';
                buttonElement.disabled = true;
            }

            const assignmentToUpdate = assignments.find(a => a.assignment_id === assignmentId);
            if (assignmentToUpdate) {
                await loadAssignments();
            }
        }
    } catch (error) {
        showStatus('Error generating AI summary: ' + error.message, 'error');
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.textContent = 'Generate AI Summary';
        }
    } finally {
        if (stateUpdated) {
            activeAISummaryRequests = Math.max(0, activeAISummaryRequests - 1);
            refreshPrimaryButtonsState();
        }
    }
}

async function removeAISummary(assignmentId, buttonElement) {
    try {
        if (isSyncInProgress) {
            showStatus('Please wait for sync to finish before removing AI summary.', 'info');
            return;
        }
        if (isInsightsModalLoading) {
            showStatus('Please wait for AI insights to finish before removing AI summary.', 'info');
            return;
        }
        if (activeAISummaryRequests > 0) {
            showStatus('Please wait for AI summary generation to finish before removing.', 'info');
            return;
        }
        if (isAddAssignmentWorkflow) {
            showStatus('Please finish adding the assignment before removing AI summary.', 'info');
            return;
        }

        activeAISummaryRequests += 1;
        refreshPrimaryButtonsState();
        if (!assignmentId) {
            showStatus('Assignment ID is missing.', 'error');
            activeAISummaryRequests = Math.max(0, activeAISummaryRequests - 1);
            refreshPrimaryButtonsState();
            return;
        }

        buttonElement.disabled = true;
        buttonElement.textContent = 'Removing...';

        // Update assignment to remove AI summary and related fields
        await fetch('/api/assignments/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                assignment_id: assignmentId,
                ai_notes: '',
                time_estimate: null,
                suggested_priority: null,
                ai_confidence: null,
                ai_confidence_explanation: null
            })
        });

        await loadAssignments();
    } catch (error) {
        showStatus('Error removing AI summary: ' + error.message, 'error');
        buttonElement.disabled = false;
        buttonElement.textContent = 'Remove AI Summary';
    } finally {
        activeAISummaryRequests = Math.max(0, activeAISummaryRequests - 1);
        refreshPrimaryButtonsState();
    }
}

async function addReminder(assignmentId, buttonElement) {
    try {
        if (isSyncInProgress) {
            showStatus('Please wait for sync to finish before adding reminders.', 'info');
            return;
        }
        if (isInsightsModalLoading) {
            showStatus('Please wait for AI insights to finish before adding reminders.', 'info');
            return;
        }
        if (activeAISummaryRequests > 0) {
            showStatus('Please wait for AI summary generation to finish before adding reminders.', 'info');
            return;
        }
        if (isAddAssignmentWorkflow) {
            showStatus('Please finish adding the assignment before adding reminders.', 'info');
            return;
        }

        activeAddReminderRequests += 1;
        refreshPrimaryButtonsState();
        if (!assignmentId) {
            showStatus('Assignment ID is missing.', 'error');
            activeAddReminderRequests = Math.max(0, activeAddReminderRequests - 1);
            refreshPrimaryButtonsState();
            return;
        }

        let assignment = assignments.find(a => a.assignment_id === assignmentId);
        if (!assignment) {
            await loadAssignments();
            assignment = assignments.find(a => a.assignment_id === assignmentId);
            if (!assignment) {
                showStatus('Assignment not found. Please refresh the page.', 'error');
                return;
            }
        }
        
        if (!assignment.reminder_list || assignment.reminder_list.trim() === '') {
            showSetupModal(false, assignmentId, `Please set a reminder list name for "${assignment.course_name}" below.`);
            return;
        }
        buttonElement.disabled = true;
        buttonElement.textContent = 'Adding...';

        const response = await fetch('/api/assignments/add-reminder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.error) {
            showStatus('Error adding reminder: ' + data.error, 'error');
            buttonElement.disabled = false;
            buttonElement.textContent = 'Add to Reminders';
        } else {
            showStatus('Reminder added successfully!', 'success');

            await loadAssignments();
        }
    } catch (error) {
        showStatus('Error adding reminder: ' + error.message, 'error');
        buttonElement.disabled = false;
        buttonElement.textContent = 'Add to Reminders';
    } finally {
        activeAddReminderRequests = Math.max(0, activeAddReminderRequests - 1);
        refreshPrimaryButtonsState();
    }
}

async function removeReminder(assignmentId, buttonElement) {
    try {
        if (isSyncInProgress) {
            showStatus('Please wait for sync to finish before removing reminders.', 'info');
            return;
        }
        if (isInsightsModalLoading) {
            showStatus('Please wait for AI insights to finish before removing reminders.', 'info');
            return;
        }
        if (activeAISummaryRequests > 0) {
            showStatus('Please wait for AI summary generation to finish before removing reminders.', 'info');
            return;
        }
        if (isAddAssignmentWorkflow) {
            showStatus('Please finish adding the assignment before removing reminders.', 'info');
            return;
        }

        activeAddReminderRequests += 1;
        refreshPrimaryButtonsState();
        if (!assignmentId) {
            showStatus('Assignment ID is missing.', 'error');
            activeAddReminderRequests = Math.max(0, activeAddReminderRequests - 1);
            refreshPrimaryButtonsState();
            return;
        }

        let assignment = assignments.find(a => a.assignment_id === assignmentId);
        if (!assignment) {
            await loadAssignments();
            assignment = assignments.find(a => a.assignment_id === assignmentId);
            if (!assignment) {
                showStatus('Assignment not found. Please refresh the page.', 'error');
                return;
            }
        }
        
        if (!assignment.reminder_list || assignment.reminder_list.trim() === '') {
            showStatus('Reminder list not found.', 'error');
            return;
        }
        
        buttonElement.disabled = true;
        buttonElement.textContent = 'Removing...';

        const response = await fetch('/api/assignments/remove-reminder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.error) {
            showStatus('Error removing reminder: ' + data.error, 'error');
            buttonElement.disabled = false;
            buttonElement.textContent = 'Added';
        } else {
            await loadAssignments();
        }
    } catch (error) {
        showStatus('Error removing reminder: ' + error.message, 'error');
        buttonElement.disabled = false;
        buttonElement.textContent = '✓ Added';
    } finally {
        activeAddReminderRequests = Math.max(0, activeAddReminderRequests - 1);
        refreshPrimaryButtonsState();
    }
}

function updateStats(assignmentsToCount = null) {
    const assignmentsToUse = assignmentsToCount !== null ? assignmentsToCount : assignments;

    // Count based on current filter
    let total;
    if (currentFilter === 'deleted') {
        total = assignmentsToUse.filter(a => a && a.deleted).length;
    } else if (currentFilter === 'course' && currentFilterCourse) {
        total = assignmentsToUse.filter(a => a && !a.deleted && a.course_name === currentFilterCourse).length;
    } else {
        total = assignmentsToUse.filter(a => a && !a.deleted).length;
    }

    document.getElementById('totalAssignments').textContent = total;
    updateSidebarCounts();
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



async function loadDeletedAssignments() {
    try {
        const response = await fetch('/api/assignments/deleted');
        const data = await response.json();
        if (data.error) {
            console.error('Error loading deleted assignments:', data.error);
            return [];
        }
        return data;
    } catch (error) {
        console.error('Error loading deleted assignments:', error);
        return [];
    }
}

async function displayDeletedAssignments() {
    const deleted = await loadDeletedAssignments();
    const container = document.getElementById('deletedAssignmentsList');

    if (deleted.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px; font-style: italic;">No recently deleted assignments</p>';
        return;
    }

    container.innerHTML = deleted.map(item => {
        const deletedDate = new Date(item.deleted_at);
        // Check if course still exists
        const courseExists = courses.some(c => {
            const cName = (c.name || c.course_name || '').trim();
            return cName.toLowerCase() === (item.course_name || '').toLowerCase();
        });
        const classRemoved = !courseExists;
        
        return `
            <div class="deleted-assignment-card">
                <div>
                    <div style="font-weight: 600; margin-bottom: 5px;">${escapeHtml(item.title)}</div>
                    <div style="font-size: 0.85em; color: #666;">
                        ${escapeHtml(item.course_name)} • Deleted ${deletedDate.toLocaleDateString()}
                        ${classRemoved ? '<span style="color: #d32f2f; font-weight: 600; margin-left: 8px;">(Class removed)</span>' : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    ${classRemoved ? '' : `<button class="btn btn-secondary" onclick="restoreAssignment('${escapeHtml(item.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px;">Restore</button>`}
                    <button class="btn btn-secondary" onclick="permanentlyDeleteAssignment('${escapeHtml(item.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px; background: #d32f2f;">Delete Forever</button>
                </div>
            </div>
        `;
    }).join('');
}

async function displayDeletedAssignmentsInMainView() {
    const deleted = await loadDeletedAssignments();
    const container = document.getElementById('assignmentsList');
    const completedSection = document.getElementById('completedAssignmentsSection');
    
    // Hide completed section
    if (completedSection) {
        completedSection.style.display = 'none';
    }
    
    // Hide completed status
    const completedStatus = document.getElementById('completedStatus');
    if (completedStatus) {
        completedStatus.style.display = 'none';
    }

    if (deleted.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px; font-style: italic;">No recently deleted assignments</p>';
        return;
    }

    container.innerHTML = deleted.map(item => {
        const deletedDate = new Date(item.deleted_at);
        // Check if course still exists
        const courseExists = courses.some(c => {
            const cName = (c.name || c.course_name || '').trim();
            return cName.toLowerCase() === (item.course_name || '').toLowerCase();
        });
        const classRemoved = !courseExists;
        
        return `
            <div class="deleted-assignment-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: #ffffff; border: 1px solid #e5e5e7; border-radius: 8px;">
                <div>
                    <div style="font-weight: 600; margin-bottom: 5px; font-size: 0.9em;">${escapeHtml(item.title)}</div>
                    <div style="font-size: 0.75em; color: #666;">
                        ${escapeHtml(item.course_name)} • Deleted ${deletedDate.toLocaleDateString()}
                        ${classRemoved ? '<span style="color: #d32f2f; font-weight: 600; margin-left: 8px;">(Class removed)</span>' : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    ${classRemoved ? '' : `<button class="btn btn-secondary" onclick="restoreAssignment('${escapeHtml(item.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px;">Restore</button>`}
                    <button class="btn btn-secondary" onclick="permanentlyDeleteAssignment('${escapeHtml(item.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px; background: #d32f2f; color: #ffffff;">Delete Forever</button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleDeletedSection() {
    const modal = document.getElementById('deletedModal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    displayDeletedAssignments();
}

function closeDeletedModal() {
    const modal = document.getElementById('deletedModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function restoreAssignment(assignmentId) {
    try {
        // Check if assignment's course still exists
        const deleted = await loadDeletedAssignments();
        const deletedAssignment = deleted.find(a => a.assignment_id === assignmentId);
        if (deletedAssignment) {
            const courseExists = courses.some(c => {
                const cName = (c.name || c.course_name || '').trim();
                return cName.toLowerCase() === (deletedAssignment.course_name || '').toLowerCase();
            });
            if (!courseExists) {
                showStatus('Cannot restore: The class for this assignment has been removed. Please delete it permanently.', 'error');
                return;
            }
        }
        
        const response = await fetch('/api/assignments/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.success) {
            showStatus('Assignment restored', 'success');
            await loadAssignments();
            if (currentFilter === 'deleted') {
                displayDeletedAssignmentsInMainView();
            } else {
                filterAssignments();
            }
        } else {
            showStatus('Error: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error restoring assignment: ' + error.message, 'error');
    }
}

async function permanentlyDeleteAssignment(assignmentId) {
    if (!confirm('Are you sure you want to permanently delete this assignment? This cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch('/api/assignments/permanently-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.success) {
            showStatus('Assignment permanently deleted', 'success');
            if (currentFilter === 'deleted') {
                displayDeletedAssignmentsInMainView();
            } else {
                await loadAssignments();
                filterAssignments();
            }
        } else {
            showStatus('Error: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error deleting assignment: ' + error.message, 'error');
    }
}

async function deleteAssignment(assignmentId) {
    try {
        const response = await fetch('/api/assignments/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.success) {
            focusedAssignmentId = null;
            await loadAssignments();
            if (currentFilter === 'deleted') {
                displayDeletedAssignmentsInMainView();
            } else {
                filterAssignments();
            }
        } else {
            showStatus('Error: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error deleting assignment: ' + error.message, 'error');
    }
}


function handleKeyboardShortcuts(e) {
    // Only handle if not typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    if ((e.key === 'Delete' || e.key === 'Backspace') && focusedAssignmentId) {
        e.preventDefault();
        deleteAssignment(focusedAssignmentId);
    }
}

function showContextMenu(e, assignmentId) {
    e.preventDefault();
    
    // Remove existing context menu
    const existingMenu = document.getElementById('contextMenu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    // Create context menu
    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.style.zIndex = '10000';
    menu.innerHTML = `
        <button class="context-menu-item" onclick="deleteAssignment('${escapeHtml(assignmentId)}'); document.getElementById('contextMenu')?.remove();">
            Delete
        </button>
    `;
    
    document.body.appendChild(menu);
    
    // Close menu when clicking outside
    setTimeout(() => {
        const closeMenu = (event) => {
            if (!menu.contains(event.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }, 0);
}

function handleRightClick(e) {
    // Let the assignment card handle its own context menu
    if (e.target.closest('.assignment-card')) {
        return;
    }
    
    // Close context menu if clicking elsewhere
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
        contextMenu.remove();
    }
}

function bulkDelete() {
    if (selectedAssignments.size === 0) return;
    if (!confirm(`Delete ${selectedAssignments.size} assignment(s)? They will be moved to Recently Deleted.`)) {
        return;
    }
    const ids = Array.from(selectedAssignments);
    ids.forEach(id => deleteAssignment(id));
    cancelBulkSelection();
}

let insightsExist = false;
let cachedInsightsEndDate = null;
let isRefreshingInsights = false;

async function checkInsightsExist() {
    try {
        const response = await fetch('/api/ai-insights/check');
        const data = await response.json();
        if (data.exists) {
            insightsExist = true;
            cachedInsightsEndDate = data.end_date;
        } else {
            insightsExist = false;
            cachedInsightsEndDate = null;
        }
    } catch (error) {
        console.error('Error checking insights:', error);
        insightsExist = false;
        cachedInsightsEndDate = null;
    }
}

function openAIInsightsDateModal(forceRefresh = false) {
    if (isAddAssignmentWorkflow || activeAddReminderRequests > 0) {
        showStatus('Please finish adding the assignment before generating insights.', 'info');
        return;
    }
    isRefreshingInsights = forceRefresh;
    const modal = document.getElementById('aiInsightsDateModal');
    const endDateInput = document.getElementById('insightsEndDate');

    const today = new Date();

    const estDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    estDate.setMonth(estDate.getMonth() + 1);

    const defaultDate = estDate.toISOString().split('T')[0];

    if (cachedInsightsEndDate && !forceRefresh) {
        endDateInput.value = cachedInsightsEndDate;
    } else {
        endDateInput.value = defaultDate;
    }

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    endDateInput.focus();
}

function closeAIInsightsDateModal() {
    const modal = document.getElementById('aiInsightsDateModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function generateAIInsights() {
    const endDateInput = document.getElementById('insightsEndDate');
    const endDate = endDateInput.value;

    if (!endDate) {
        showStatus('Please select an end date', 'error');
        return;
    }

    const shouldForceRefresh = isRefreshingInsights;
    closeAIInsightsDateModal();

    setTimeout(async () => {
        await showAIInsights(shouldForceRefresh, endDate);
    }, 150);
}

async function showAIInsights(forceRefresh = false, endDate = null) {
    if (!endDate) {
        endDate = cachedInsightsEndDate;
    }

    if (!endDate) {
        openAIInsightsDateModal(false);
        return;
    }

    const dateModal = document.getElementById('aiInsightsDateModal');
    if (dateModal && dateModal.style.display === 'block') {
        closeAIInsightsDateModal();
    }

    const modal = document.getElementById('aiInsightsModal');
    const content = document.getElementById('aiInsightsContent');
    const refreshBtn = document.getElementById('refreshInsightsBtn');
    const closeBtn = modal ? modal.querySelector('.close') : null;

    isInsightsModalLoading = true;
    refreshPrimaryButtonsState();
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    refreshBtn.disabled = true;
    if (closeBtn) closeBtn.style.display = 'none';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            content.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <div class="sync-spinner" style="margin: 0 auto 20px;"></div>
                    <p>${forceRefresh ? 'Regenerating' : 'Loading'} AI insights...</p>
                </div>
            `;

            loadAIInsightsContent(forceRefresh, endDate, modal, content, refreshBtn, closeBtn);
        });
    });
}

async function loadAIInsightsContent(forceRefresh, endDate, modal, content, refreshBtn, closeBtn) {
    try {
        const targetEndDate = endDate || cachedInsightsEndDate || (() => {
            const today = new Date();
            const estDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            estDate.setMonth(estDate.getMonth() + 1);
            return estDate.toISOString().split('T')[0];
        })();

        const url = forceRefresh
            ? `/api/ai-insights?refresh=true&end_date=${targetEndDate}`
            : `/api/ai-insights?end_date=${targetEndDate}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            content.innerHTML = `<div style="color: #d32f2f; padding: 20px; text-align: center;">Error: ${escapeHtml(data.error)}</div>`;
            refreshBtn.disabled = false;
            if (closeBtn) closeBtn.style.display = '';
            isInsightsModalLoading = false;
            refreshPrimaryButtonsState();
            return;
        }

        if (data.success) {
            insightsExist = true;
            cachedInsightsEndDate = targetEndDate;
        }

        const insights = data.insights;
        const isCached = data.cached;
        const generatedAt = data.generated_at;

        let html = '';

        html += `<div style="background: #f0f4ff; border-left: 3px solid #667eea; padding: 10px 15px; margin-bottom: 20px; border-radius: 4px; font-size: 0.85em; color: #555;">
            <strong>🤖 AI Generated</strong> - This content is generated by AI and should be used as a guide. Please verify important information and dates.
        </div>`;

        if (isCached) {
            const date = new Date(generatedAt);

            const estDate = date.toLocaleString('en-US', {
                timeZone: 'America/New_York',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            html += `<div style="background: #e7f3ff; border-left: 3px solid var(--primary-color); padding: 10px 15px; margin-bottom: 20px; border-radius: 4px; font-size: 0.9em; color: #666;">
                <strong>📋 Cached Results</strong> - Generated ${estDate} EST
            </div>`;
        }

        const getConfidenceStars = (confidence, explanation, textColor = 'var(--text-secondary)') => {
            if (confidence === null || confidence === undefined) return '';
            const stars = '★'.repeat(confidence);
            const emptyStars = '☆'.repeat(5 - confidence);
            let tooltipText = `AI Confidence: ${confidence}/5`;
            if (explanation) {
                tooltipText += `\n\n${escapeHtml(explanation)}`;
            }
            return `<span class="ai-confidence" style="display: inline-flex; align-items: center; gap: 4px; color: ${textColor}; font-size: 0.85em; cursor: help;" title="${tooltipText}"><span style="opacity: 0.7;">AI Confidence:</span>${stars}${emptyStars}</span>`;
        };

        if (insights.summary_report) {
            const confidenceStars = getConfidenceStars(insights.summary_confidence, insights.summary_confidence_explanation, 'rgba(255, 255, 255, 0.9)');
            html += `
                <div class="insight-section" style="margin-bottom: 30px; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin: 0 0 15px 0;">
                        <h3 style="margin: 0; color: white;">Quick Overview</h3>${confidenceStars}
                    </div>
                    <p style="margin: 0; line-height: 1.6; font-size: 1.05em;">${escapeHtml(insights.summary_report)}</p>
                </div>
            `;
        }

        if (insights.workload_analysis) {
            const wa = insights.workload_analysis;
            const confidenceStars = getConfidenceStars(insights.workload_confidence, insights.workload_confidence_explanation);
            html += `
                <div class="insight-section" style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin: 0 0 15px 0;">
                        <h3 style="margin: 0; color: var(--primary-color);">Your Workload</h3>${confidenceStars}
                    </div>
                    <p style="margin: 10px 0;"><strong>Overall Assessment:</strong> ${escapeHtml(wa.overall_assessment || 'N/A')}</p>
                    ${wa.total_hours_estimated ? `<p style="margin: 10px 0;"><strong>Total Hours Estimated:</strong> ${wa.total_hours_estimated} hours</p>` : ''}
                    ${wa.busy_periods && wa.busy_periods.length > 0 ? `<p style="margin: 10px 0;"><strong>Busy Periods:</strong> ${escapeHtml(wa.busy_periods.join(', '))}</p>` : ''}
                    ${wa.risk_assessment ? `<p style="margin: 10px 0;"><strong>Risk Assessment:</strong> ${escapeHtml(wa.risk_assessment)}</p>` : ''}
                    ${wa.course_difficulty_comparison ? `
                        <div style="margin-top: 15px;">
                            <strong>Course Difficulty:</strong>
                            <ul style="margin: 10px 0; padding-left: 20px;">
                                ${Object.entries(wa.course_difficulty_comparison).map(([course, diff]) =>
                                    `<li>${escapeHtml(course)}: ${escapeHtml(diff)}</li>`
                                ).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        if (insights.priority_recommendations && insights.priority_recommendations.length > 0) {
            const confidenceStars = getConfidenceStars(insights.priority_confidence, insights.priority_confidence_explanation);
            html += `
                <div class="insight-section" style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin: 0 0 15px 0;">
                        <h3 style="margin: 0; color: var(--primary-color);">Start Here</h3>${confidenceStars}
                    </div>
                    ${insights.priority_recommendations.map(rec => `
                        <div style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 6px; border-left: 4px solid var(--primary-color);">
                            <strong>${escapeHtml(rec.assignment_title || 'Unknown')}</strong>
                            ${rec.urgency_level ? `<span style="margin-left: 10px; padding: 2px 8px; background: ${rec.urgency_level === 'High' ? '#ffebee' : rec.urgency_level === 'Medium' ? '#fff3e0' : '#e8f5e9'}; border-radius: 4px; font-size: 0.85em;">${escapeHtml(rec.urgency_level)}</span>` : ''}
                            ${rec.reason ? `<p style="margin: 8px 0 0 0; color: #666;">${escapeHtml(rec.reason)}</p>` : ''}
                            ${rec.suggested_start_date ? `<p style="margin: 5px 0 0 0; font-size: 0.9em; color: #888;"><strong>Suggested Start:</strong> ${escapeHtml(rec.suggested_start_date)}</p>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (insights.conflict_detection) {
            const cd = insights.conflict_detection;
            const confidenceStars = getConfidenceStars(insights.conflict_confidence, insights.conflict_confidence_explanation, '#f57c00');
            html += `
                <div class="insight-section" style="margin-bottom: 30px; padding: 20px; background: #fff3e0; border-radius: 8px; border-left: 4px solid #ff9800;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin: 0 0 15px 0;">
                        <h3 style="margin: 0; color: #f57c00;">Watch Out</h3>${confidenceStars}
                    </div>
                    ${cd.overlapping_deadlines && cd.overlapping_deadlines.length > 0 ? `
                        <p style="margin: 10px 0;"><strong>Overlapping Deadlines:</strong></p>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                            ${cd.overlapping_deadlines.map(date => `<li>${escapeHtml(date)}</li>`).join('')}
                        </ul>
                    ` : ''}
                    ${cd.scheduling_conflicts ? `<p style="margin: 10px 0;"><strong>Conflicts:</strong> ${escapeHtml(cd.scheduling_conflicts)}</p>` : ''}
                    ${cd.early_start_recommendations && cd.early_start_recommendations.length > 0 ? `
                        <p style="margin: 10px 0;"><strong>Start Early:</strong></p>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                            ${cd.early_start_recommendations.map(rec => `<li>${escapeHtml(rec)}</li>`).join('')}
                        </ul>
                    ` : ''}
                </div>
            `;
        }
        if (!html) {
            html = '<p style="text-align: center; padding: 40px; color: #666;">No insights available. Please sync assignments first.</p>';
        }

        content.innerHTML = html;
        refreshBtn.disabled = false;
        if (closeBtn) closeBtn.style.display = '';
        isInsightsModalLoading = false;
        refreshPrimaryButtonsState();

    } catch (error) {
        content.innerHTML = `<div style="color: #d32f2f; padding: 20px; text-align: center;">Error loading AI insights: ${escapeHtml(error.message)}</div>`;
        refreshBtn.disabled = false;
        if (closeBtn) closeBtn.style.display = '';
        isInsightsModalLoading = false;
        refreshPrimaryButtonsState();
    }
}

function closeAIInsightsModal() {
    if (isInsightsModalLoading) {
        showStatus('Please wait for AI insights to finish loading before closing.', 'info');
        return;
    }
    const modal = document.getElementById('aiInsightsModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    refreshPrimaryButtonsState();
}

function closeAssignmentDetailsModal() {
    document.getElementById('assignmentDetailsModal').style.display = 'none';
}

function bulkDelete() {
    if (selectedAssignments.size === 0) return;
    const ids = Array.from(selectedAssignments);
    for (const id of ids) {
        deleteAssignment(id);
    }
    cancelBulkSelection();
}
async function bulkAddReminders() {
    if (selectedAssignments.size === 0) return;
    const ids = Array.from(selectedAssignments);
    for (const id of ids) {
        await addReminder(id);
    }
    cancelBulkSelection();
}

function cancelBulkSelection() {
    selectedAssignments.clear();
    document.getElementById('bulkActions').style.display = 'none';
    filterAssignments();
}

async function bulkUpdateAssignments(assignmentIds, fields) {
    try {
        const response = await fetch('/api/assignments/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignment_ids: assignmentIds, fields })
        });
        const data = await response.json();
        if (data.success) {
            showStatus(`Updated ${data.updated} assignments`, 'success');
            loadAssignments();
            cancelBulkSelection();
        } else {
            showStatus('Error: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error updating assignments: ' + error.message, 'error');
    }
}

async function updateAssignmentField(assignmentId, field, value) {
    try {
        const response = await fetch('/api/assignments/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignment_id: assignmentId, [field]: value })
        });
        const data = await response.json();
        if (data.success) {
            const assignment = assignments.find(a => a.assignment_id === assignmentId);
            if (assignment) {
                assignment[field] = value;
            }
            filterAssignments();
            updateStats();
        } else {
            throw new Error(data.error || 'Failed to update assignment');
        }
    } catch (error) {
        console.error('Error updating assignment:', error);
        throw error;
    }
}

async function openAddClassModal() {
    const courseName = prompt('Enter course name:');
    if (!courseName || !courseName.trim()) {
        return;
    }
    const trimmedCourseName = courseName.trim();
    
    // Check if course already exists in courses list
    await loadCourses();
    const existingCourse = courses.find(c => {
        const cName = (c.name || c.course_name || '').trim();
        return cName.toLowerCase() === trimmedCourseName.toLowerCase();
    });
    
    // Also check if course exists in assignments
    const existingInAssignments = assignments.some(a => {
        const aName = (a.course_name || '').trim();
        return aName.toLowerCase() === trimmedCourseName.toLowerCase();
    });
    
    if (existingCourse || existingInAssignments) {
        showStatus('A class with this name already exists', 'error');
        return;
    }
    
    // For manual classes, use the same name for both course name and reminder list
    try {
        // Save the course mapping
        const response = await fetch('/api/course-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                course_name: trimmedCourseName, 
                reminder_list: trimmedCourseName 
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to add class');
        }
        
        showStatus('Class added successfully', 'success');
        await loadCourses();
        populateSidebarCourses();
    } catch (error) {
        showStatus('Error adding class: ' + error.message, 'error');
    }
}

function showInlineAssignmentForm(courseName, displayCourseName) {
    // Don't allow opening form if sync is in progress
    if (isSyncInProgress) {
        showStatus('Please wait for sync to finish before adding assignments.', 'info');
        return;
    }
    
    // Don't allow opening form if already adding an assignment
    if (isAddingAssignment) {
        return;
    }
    
    // Hide any other open inline forms
    document.querySelectorAll('.inline-assignment-form').forEach(form => {
        form.style.display = 'none';
    });
    
    // Use a safe ID that matches what we use in displayAssignments
    const safeFormId = `inline-form-${courseName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    let formContainer = document.getElementById(safeFormId);
    
    if (!formContainer) {
        // Create form container if it doesn't exist
        formContainer = document.createElement('div');
        formContainer.id = safeFormId;
        formContainer.className = 'inline-assignment-form';
        
        // Find the parent container and append
        const assignmentsList = document.getElementById('assignmentsList');
        if (assignmentsList) {
            assignmentsList.appendChild(formContainer);
        } else {
            // Try to find course group section
            const courseSection = document.querySelector(`[data-course-name="${courseName}"]`);
            if (courseSection) {
                const assignmentsDiv = courseSection.querySelector('.course-group-assignments');
                if (assignmentsDiv) {
                    assignmentsDiv.appendChild(formContainer);
                }
            }
        }
    }
    
    const escapedCourseName = courseName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const escapedDisplayName = displayCourseName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    
    formContainer.innerHTML = `
        <div class="inline-assignment-form-content">
            <div class="inline-form-group">
                <label>Title <span class="required">*</span></label>
                <input type="text" class="inline-form-input" id="inline-title-${escapedCourseName.replace(/[^a-zA-Z0-9_-]/g, '_')}" placeholder="Enter assignment title" required>
            </div>
            <div class="inline-form-group">
                <label>Due Date & Time <span class="required">*</span></label>
                <input type="datetime-local" class="inline-form-input" id="inline-due-${escapedCourseName.replace(/[^a-zA-Z0-9_-]/g, '_')}" required>
            </div>
            <div class="inline-form-group">
                <label>Description (optional, for AI)</label>
                <textarea class="inline-form-textarea" id="inline-desc-${escapedCourseName.replace(/[^a-zA-Z0-9_-]/g, '_')}" rows="3" placeholder="Enter assignment description, requirements, or details..."></textarea>
            </div>
            <div class="inline-form-actions">
                <div class="inline-form-actions-primary">
                    <button class="btn btn-primary" onclick="saveInlineAssignment('${escapedCourseName}', '${escapedDisplayName}', true)">Add Assignment with AI Summary</button>
                    <button class="btn btn-secondary" onclick="saveInlineAssignment('${escapedCourseName}', '${escapedDisplayName}', false)">Add Assignment</button>
                </div>
                <button class="btn btn-link" onclick="hideInlineAssignmentForm('${escapedCourseName}')">Cancel</button>
            </div>
        </div>
    `;
    
    formContainer.style.display = 'block';
    const titleInput = document.getElementById(`inline-title-${escapedCourseName.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    if (titleInput) titleInput.focus();
}

function hideInlineAssignmentForm(courseName) {
    const safeFormId = `inline-form-${courseName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const formContainer = document.getElementById(safeFormId);
    if (formContainer) {
        formContainer.style.display = 'none';
    }
}

function updateAddAssignmentButtonsState() {
    const hints = document.querySelectorAll('.add-assignment-hint');
    hints.forEach(hint => {
        if (isAddingAssignment || isSyncInProgress) {
            hint.style.opacity = '0.5';
            hint.style.pointerEvents = 'none';
            hint.style.cursor = 'not-allowed';
        } else {
            hint.style.opacity = '1';
            hint.style.pointerEvents = 'auto';
            hint.style.cursor = 'pointer';
        }
    });
}

let isAddingAssignment = false;

async function saveInlineAssignment(courseName, displayCourseName, useAI = false) {
    if (isAddingAssignment) {
        return;
    }

    const safeId = courseName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const title = document.getElementById(`inline-title-${safeId}`).value.trim();
    const dueDate = document.getElementById(`inline-due-${safeId}`).value;
    const description = document.getElementById(`inline-desc-${safeId}`).value.trim();

    if (!title) {
        showStatus('Please enter an assignment title', 'error');
        return;
    }
    if (!dueDate) {
        showStatus('Please select a due date and time', 'error');
        return;
    }

    isAddingAssignment = true;
    isAddAssignmentWorkflow = true;
    refreshPrimaryButtonsState();
    updateAddAssignmentButtonsState();
    hideInlineAssignmentForm(courseName);

    const progressContainer = document.getElementById('syncProgress');
    const progressText = document.getElementById('syncProgressText');
    const progressTime = document.getElementById('syncProgressTime');
    const progressCount = document.getElementById('syncProgressCount');
    const progressTop = document.querySelector('#syncProgress .sync-progress-top');
    progressContainer.style.display = 'block';
    if (useAI) {
        progressText.textContent = 'Generating AI summary...';
    } else {
        progressText.textContent = 'Adding assignment...';
    }
    progressTime.textContent = '';
    if (progressCount) progressCount.textContent = '';
    if (progressTop) progressTop.style.display = 'none';

    try {
        // Get reminder list for this course
        let reminderList = '';
        const course = courses.find(c => c.course_name === courseName);
        if (course) {
            reminderList = course.reminder_list || '';
        }
        
        // If no reminder list found, use displayCourseName as fallback
        if (!reminderList || reminderList.trim() === '') {
            reminderList = displayCourseName;
        }

        const dueDateObj = new Date(dueDate);
        const dueAtISO = dueDateObj.toISOString().replace(/\.\d{3}Z$/, 'Z');
        const assignmentId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const response = await fetch('/api/assignments/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignment_id: assignmentId,
                title: title,
                description: description,
                due_at: dueAtISO,
                course_name: courseName,
                reminder_list: reminderList,
                use_ai: useAI
            })
        });

        const data = await response.json();
        if (data.success) {
            if (useAI) {
                progressText.textContent = 'Assignment added! AI summary generated.';
            } else {
                progressText.textContent = 'Assignment added successfully!';
            }
            await loadAssignments();
            updateStats();
            updateAddAssignmentButtonsState();

            setTimeout(() => {
                progressContainer.style.display = 'none';
                if (progressTop) progressTop.style.display = 'flex';
            }, 800);
            isAddAssignmentWorkflow = false;
            refreshPrimaryButtonsState();
        } else {
            throw new Error(data.error || 'Failed to add assignment');
        }
    } catch (error) {
        progressContainer.style.display = 'none';
        if (progressTop) progressTop.style.display = 'flex';
        showStatus('Error adding assignment: ' + error.message, 'error');
        isAddAssignmentWorkflow = false;
        refreshPrimaryButtonsState();
    } finally {
        isAddingAssignment = false;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForAISummary(targetAssignmentId, pollIntervalMs = 1500, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const a = assignments.find(x => x && x.assignment_id === targetAssignmentId);
        if (a && a.ai_notes && String(a.ai_notes).trim().length > 0) {
            return true;
        }
        try {
            await loadAssignments();
            const b = assignments.find(x => x && x.assignment_id === targetAssignmentId);
            if (b && b.ai_notes && String(b.ai_notes).trim().length > 0) {
                return true;
            }
        } catch (_) {
        }
        await sleep(pollIntervalMs);
    }
    return false;
}

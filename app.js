let assignments = [];
let courses = [];
let collegeName = null;
let pendingReminderAssignmentId = null;
let courseEnableDisableChanges = {};
let reminderListChanges = {};
let originalCourseStates = {};
let selectedAssignments = new Set();
let groupByCourse = false;
let isSetupModalForced = false;
let activeAISummaryRequests = 0;
let activeAddReminderRequests = 0;
let isSyncInProgress = false;
let isInsightsModalLoading = false;
let isAddAssignmentWorkflow = false;
let aiSummaryEnabled = true;

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

    document.getElementById('addAssignmentBtn').addEventListener('click', openAddAssignmentModal);
    document.getElementById('syncBtn').addEventListener('click', syncAssignments);
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    // Settings auto-save on change - no save button needed
    document.getElementById('groupByCourse').addEventListener('change', (e) => {
        groupByCourse = e.target.checked;
        filterAssignments();
    });
    document.getElementById('selectAllBtn').addEventListener('click', selectAllAssignments);
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
    document.getElementById('bulkComplete').addEventListener('click', bulkMarkComplete);
    document.getElementById('bulkDelete').addEventListener('click', bulkDelete);
    document.getElementById('bulkAddReminders').addEventListener('click', bulkAddReminders);
    document.getElementById('bulkCancel').addEventListener('click', cancelBulkSelection);
    document.getElementById('toggleCompletedBtn').addEventListener('click', toggleCompletedSection);
    document.getElementById('toggleDeletedBtn').addEventListener('click', toggleDeletedSection);
    document.getElementById('saveAndSync').addEventListener('click', saveAndSync);
    document.getElementById('cancelSetup').addEventListener('click', () => {
        if (isSetupModalForced) {
            return;
        }
        closeSetupModal();
    });

    const saveNotesBtn = document.getElementById('saveNotesBtn');
    if (saveNotesBtn) {
        saveNotesBtn.addEventListener('click', saveNotes);
    }

    const saveAddAssignmentBtn = document.getElementById('saveAddAssignmentBtn');
    if (saveAddAssignmentBtn) {
        saveAddAssignmentBtn.addEventListener('click', saveAddAssignment);
    }

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
            filterAssignments();
            updateStats();
            attachReminderListeners();
            attachAISummaryListeners();
            loadCompletedAssignments();
        }
        refreshPrimaryButtonsState();
    } catch (error) {
        console.error('Error loading assignments:', error);
        assignments = [];
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
    const btn = document.getElementById('addAssignmentBtn');
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
            return;
        }

        if (!Array.isArray(data)) {
            console.error('Invalid courses data format:', data);
            courses = [];
            return;
        }

        courses = data;
    } catch (error) {
        console.error('Error loading courses:', error);
        courses = [];
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
        const canvasCourseNames = new Set();
        data.forEach(course => {
            if (!course || !course.name) {
                return;
            }

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
            const displayReminderList = reminderListChanges[courseName] !== undefined 
                ? reminderListChanges[courseName] 
                : (reminderList || courseName);

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

            const hasValidReminderList = displayReminderList && displayReminderList.trim() !== '';
            reminderListSpan.textContent = displayReminderList;
            reminderListSpan.dataset.courseName = courseName;
            reminderListSpan.dataset.reminderList = displayReminderList;
            reminderListSpan.title = 'Click to edit reminder list name';
            reminderListSpan.style.cursor = 'pointer';
            reminderListSpan.style.color = '#667eea';
            reminderListSpan.style.textDecoration = 'underline';
            reminderListSpan.style.textDecorationStyle = 'dotted';
            reminderListSpan.style.fontWeight = 'normal';

            reminderListSpan.addEventListener('click', () => {
                editReminderList(courseName, reminderList || courseName);
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

        try {
            const assignmentsResp = await fetch('/api/assignments');
            const assignmentsData = await assignmentsResp.json();
            if (Array.isArray(assignmentsData)) {
                const manualNames = new Set();
                const nameToReminder = {};
                assignmentsData.forEach(a => {
                    if (!a || !a.course_name) return;
                    const name = String(a.course_name);
                    if (canvasCourseNames.has(name)) return;
                    manualNames.add(name);
                    if (!nameToReminder[name] && a.reminder_list && String(a.reminder_list).trim() !== '') {
                        nameToReminder[name] = String(a.reminder_list).trim();
                    }
                });
                if (manualNames.size > 0) {
                    // Fetch course mappings for manually added courses
                    const mappingPromises = Array.from(manualNames).map(async (courseName) => {
                        try {
                            const mappingResp = await fetch(`/api/course-mapping?course_name=${encodeURIComponent(courseName)}`);
                            const mappingData = await mappingResp.json();
                            if (mappingData.reminder_list) {
                                nameToReminder[courseName] = mappingData.reminder_list;
                            }
                        } catch (e) {
                            // If no mapping exists, use assignment value or course name
                        }
                    });
                    await Promise.all(mappingPromises);

                    const separator = document.createElement('div');
                    separator.style.width = '100%';
                    separator.innerHTML = `
                        <div style="border-top: 1px solid var(--border-color); margin: 25px 0 15px;"></div>
                        <div style="font-weight: 700; color: var(--primary-color); margin-bottom: 12px;">Manually Added Courses</div>
                    `;
                    coursesList.appendChild(separator);

                    Array.from(manualNames).sort().forEach(courseName => {
                        const item = document.createElement('div');
                        item.className = 'course-item';
                        const savedReminder = nameToReminder[courseName] || courseName;
                        // Use pending change if exists, otherwise use saved value
                        const currentReminder = reminderListChanges[courseName] !== undefined 
                            ? reminderListChanges[courseName] 
                            : savedReminder;

                        const courseInfo = document.createElement('div');
                        courseInfo.className = 'course-info';
                        courseInfo.innerHTML = `
                            <strong>${escapeHtml(courseName)}</strong>
                            <div style="margin-top: 4px; font-size: 0.85em;">
                                <span style="color: #666;">Reminder List: </span>
                            </div>
                        `;

                        const reminderSpan = document.createElement('span');
                        reminderSpan.className = 'reminder-list-editable';
                        reminderSpan.textContent = currentReminder;
                        reminderSpan.dataset.courseName = courseName;
                        reminderSpan.dataset.reminderList = currentReminder;
                        reminderSpan.title = 'Click to edit reminder list name';
                        reminderSpan.style.cursor = 'pointer';
                        reminderSpan.style.color = '#667eea';
                        reminderSpan.style.textDecoration = 'underline';
                        reminderSpan.style.textDecorationStyle = 'dotted';
                        reminderSpan.style.fontWeight = 'normal';
                        reminderSpan.addEventListener('click', () => {
                            editReminderList(courseName, savedReminder);
                        });

                        courseInfo.querySelector('div').appendChild(reminderSpan);
                        item.appendChild(courseInfo);
                        coursesList.appendChild(item);
                    });
                }
            }
        } catch (e) {
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
    actionButton.textContent = newState ? '×' : '✓';
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

        const coursesNeedingSetup = data.filter(course => {
            if (!course || !course.name) return false;
            const reminderList = course.reminder_list ? course.reminder_list.trim() : '';
            const hasReminderList = reminderList !== '';

            return !hasReminderList;
        });

        if (coursesNeedingSetup.length === 0) {
            coursesList.innerHTML = '<p style="color: #666; font-style: italic;">All courses have reminder list names set.</p>';
            return;
        }

        coursesList.innerHTML = '';
        coursesNeedingSetup.forEach(course => {
            const isEnabled = course.enabled === true || course.enabled === 1 || course.enabled === '1';
            const defaultName = course.name ? course.name.trim() : '';
            let currentReminderList = (isEnabled && course.reminder_list && course.reminder_list.trim()) ? course.reminder_list.trim() : '';
            if (!currentReminderList) {
                currentReminderList = defaultName;
            }
            const courseItem = document.createElement('div');
            courseItem.className = 'course-item';
            courseItem.style.marginBottom = '10px';

            courseItem.innerHTML = `
                <div class="course-info" style="flex: 1;">
                    <strong>${escapeHtml(course.name)}</strong>
                    ${!isEnabled ? '<span style="margin-left: 8px; font-size: 0.85em; color: #999; font-style: italic;">(Disabled)</span>' : ''}
                    <div style="margin-top: 8px;">
                        <input type="text"
                               class="form-input reminder-list-input"
                               data-course-name="${escapeHtml(course.name)}"
                               placeholder="Enter reminder list name (required)"
                               value="${escapeHtml(currentReminderList)}"
                               autocomplete="off"
                               spellcheck="false"
                               style="width: 100%; padding: 8px; border: 2px solid #e0e0e0; border-radius: 6px;">
                    </div>
                </div>
            `;

            const input = courseItem.querySelector('.reminder-list-input');

            if (currentReminderList && isEnabled) {
                input.style.borderColor = '#4caf50';
            }
            input.addEventListener('input', function() {
                if (this.value.trim()) {
                    this.style.borderColor = '#4caf50';
                } else {
                    this.style.borderColor = '#e0e0e0';
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
    const aiInsightsBtn = document.getElementById('aiInsightsBtn');
    const addAssignmentBtn = document.getElementById('addAssignmentBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const progressContainer = document.getElementById('syncProgress');
    const progressCount = document.getElementById('syncProgressCount');
    const progressTime = document.getElementById('syncProgressTime');
    const progressText = document.getElementById('syncProgressText');
    const progressBar = document.getElementById('syncProgressBar');

    isSyncInProgress = true;
    btn.textContent = 'Syncing...';
    refreshPrimaryButtonsState();
    if (addAssignmentBtn) {
        setButtonVisualState(addAssignmentBtn, true, 'Sync in progress');
    }
    if (settingsBtn) {
        setButtonVisualState(settingsBtn, true, 'Sync in progress');
    }

    const restoreAfterSync = () => {
        isSyncInProgress = false;
        btn.textContent = 'Sync Assignments';
        refreshPrimaryButtonsState();
        if (addAssignmentBtn) {
            setButtonVisualState(addAssignmentBtn, false);
        }
        if (settingsBtn) {
            setButtonVisualState(settingsBtn, false);
        }
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
    const missingCourses = [];

    reminderListInputs.forEach(input => {
        const courseName = input.dataset.courseName;
        const reminderList = input.value.trim();

        if (!reminderList) {
            missingCourses.push(courseName);
            input.style.borderColor = '#d32f2f';

            if (missingCourses.length === 1) {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                input.focus();
            }
        } else {
            input.style.borderColor = '#4caf50';
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

        for (const course of coursesToUpdate) {
            await fetch('/api/course-mapping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(course)
            });
        }

        await loadAssignments();

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
        } else {
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
    } else if (type === 'info') {
        warningDiv.style.background = '#d1ecf1';
        warningDiv.style.borderColor = '#0c5460';
        warningDiv.style.color = '#0c5460';
    } else if (type === 'success') {
        warningDiv.style.background = '#d4edda';
        warningDiv.style.borderColor = '#28a745';
        warningDiv.style.color = '#155724';
    }
    
    warningDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const notesModal = document.getElementById('notesModal');
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
    if (event.target === notesModal) {
        closeNotesModal();
    }
    if (event.target === addAssignmentModal) {
        closeAddAssignmentModal();
    }
    if (event.target === settingsModal) {
        closeModal();
    }
}

function displayAssignments(assignmentsToShow) {
    const container = document.getElementById('assignmentsList');

    if (assignmentsToShow.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No assignments found.</p>';
        return;
    }

    if (groupByCourse) {
        displayGroupedAssignments(assignmentsToShow, container);
    } else {
        container.innerHTML = assignmentsToShow.map((assignment) => {
            return createAssignmentCard(assignment);
        }).join('');
    }

    if (selectedAssignments.size > 0) {
        document.getElementById('bulkActions').style.display = 'flex';
        document.getElementById('selectedCount').textContent = `${selectedAssignments.size} selected`;
    } else {
        document.getElementById('bulkActions').style.display = 'none';
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

    const courseName = assignment.course_name || 'Unknown Course';

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
        const stars = '★'.repeat(aiConfidence);
        const emptyStars = '☆'.repeat(5 - aiConfidence);
        let tooltipText = `AI Confidence: ${aiConfidence}/5`;
        if (aiConfidenceExplanation) {
            tooltipText += `\n\n${escapeHtml(aiConfidenceExplanation)}`;
        }
        confidenceStars = `<span class="ai-confidence" style="display: inline-flex; align-items: center; gap: 4px; margin-left: 12px; color: var(--text-secondary); font-size: 0.85em; cursor: help;" title="${tooltipText}"><span style="opacity: 0.7;">AI Confidence:</span>${stars}${emptyStars}</span>`;
    }

    const aiNotesSection = aiNotes ?
        `<div class="assignment-ai-notes">
            <div style="display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 0;">
                <strong>AI Summary:</strong>${confidenceStars}
            </div>
            <div style="margin: 0; padding: 0;">${escapeHtml(aiNotes)}</div>
        </div>` : '';

    const status = assignment.status || 'Not Started';

    const userNotes = assignment.user_notes || '';
    const userNotesSection = userNotes ?
        `<div class="assignment-user-notes" style="margin-top: 12px;"><strong>My Notes:</strong><br>${escapeHtml(userNotes)}</div>` : '';

    const isSelected = selectedAssignments.has(assignment.assignment_id);

    return `
        <div class="assignment-card" data-assignment-id="${escapeHtml(assignment.assignment_id)}">
            <div style="display: flex; align-items: start; gap: 12px;">
                <input type="checkbox" class="assignment-checkbox" ${isSelected ? 'checked' : ''}
                       onchange="toggleAssignmentSelection('${escapeHtml(assignment.assignment_id)}', this.checked)">
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div style="flex: 1;">
                            <div class="assignment-course-name">${escapeHtml(courseName)}</div>
                            <div class="assignment-title">${escapeHtml(title)}</div>
                        </div>
                        <div class="assignment-header-right" style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                            <div class="assignment-due">${escapeHtml(formattedDate)}</div>
                            ${assignment.reminder_added === 1 || assignment.reminder_added === true
                                ? `<button type="button" class="btn-reminder-link btn-reminder-added" data-assignment-id="${escapeHtml(assignment.assignment_id)}" disabled>✓ Added</button>`
                                : `<button type="button" class="btn-reminder-link btn-add-reminder" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Add to Reminders</button>`
                            }
                            ${aiNotes && aiNotes.trim()
                                ? `<button type="button" class="btn-reminder-link btn-ai-summary-added" data-assignment-id="${escapeHtml(assignment.assignment_id)}" disabled>✓ Generated</button>`
                                : `<button type="button" class="btn-reminder-link btn-generate-ai-summary" data-assignment-id="${escapeHtml(assignment.assignment_id)}">Generate AI Summary</button>`
                            }
                        </div>
                    </div>
                    <div class="assignment-meta">
                        <button type="button" onclick="openNotesModal('${escapeHtml(assignment.assignment_id)}')"
                                style="background: none; border: none; color: #666; cursor: pointer; font-size: 0.9em; padding: 2px 6px; opacity: 0.7; transition: opacity 0.2s;"
                                onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"
                                title="Add/edit notes">📝</button>
                        <button type="button" onclick="markAsCompleted('${escapeHtml(assignment.assignment_id)}')"
                                style="background: none; border: none; color: #4caf50; cursor: pointer; font-size: 0.9em; padding: 2px 6px; opacity: 0.7; transition: opacity 0.2s;"
                                onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"
                                title="Mark as completed">✓</button>
                        <button type="button" onclick="deleteAssignment('${escapeHtml(assignment.assignment_id)}')"
                                style="background: none; border: none; color: #999; cursor: pointer; font-size: 0.85em; padding: 2px 6px; opacity: 0.5; transition: opacity 0.2s;"
                                onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'"
                                title="Delete assignment">🗑️</button>
                    </div>
                    ${userNotesSection}
                    ${aiNotesSection}
                </div>
            </div>
        </div>
    `;
}

function displayGroupedAssignments(assignmentsToShow, container) {
    const grouped = {};
    assignmentsToShow.forEach(a => {
        const course = a.course_name || 'Unknown';
        if (!grouped[course]) grouped[course] = [];
        grouped[course].push(a);
    });

    container.innerHTML = Object.keys(grouped).sort().map(courseName => {
        const courseAssignments = grouped[courseName];
        const courseId = `course-${courseName.replace(/\s+/g, '-')}`;
        return `
            <div class="course-group">
                <div class="course-group-header" onclick="toggleCourseGroup('${courseId}')">
                    <span>${escapeHtml(courseName)} (${courseAssignments.length})</span>
                    <span class="course-group-toggle" id="${courseId}-toggle">▼</span>
                </div>
                <div class="course-group-content" id="${courseId}-content">
                    ${courseAssignments.map(a => createAssignmentCard(a)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function toggleCourseGroup(courseId) {
    const content = document.getElementById(`${courseId}-content`);
    const toggle = document.getElementById(`${courseId}-toggle`);
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        toggle.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        toggle.textContent = '▶';
    }
}

function toggleAssignmentSelection(assignmentId, checked) {
    if (checked) {
        selectedAssignments.add(assignmentId);
    } else {
        selectedAssignments.delete(assignmentId);
    }

    if (selectedAssignments.size > 0) {
        document.getElementById('bulkActions').style.display = 'flex';
        document.getElementById('selectedCount').textContent = `${selectedAssignments.size} selected`;
    } else {
        document.getElementById('bulkActions').style.display = 'none';
    }
}

function filterAssignments() {
    let filtered = assignments.filter(a => {
        if (!a) return false;
        if (a.deleted) return false;
        if (a.status === 'Completed') return false;
        return true;
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
    const button = e.target.closest('.btn-add-reminder');
    if (!button) return;

    if (activeAddReminderRequests > 0) {
        e.preventDefault();
        showStatus('A reminder is currently being added. Please wait...', 'info');
        return false;
    }
    if (isSyncInProgress) {
        e.preventDefault();
        showStatus('Please wait for sync to finish before adding reminders.', 'info');
        return false;
    }
    if (isInsightsModalLoading) {
        e.preventDefault();
        showStatus('Please wait for AI insights to finish before adding reminders.', 'info');
        return false;
    }
    if (activeAISummaryRequests > 0) {
        e.preventDefault();
        showStatus('Please wait for AI summary generation to finish before adding reminders.', 'info');
        return false;
    }
    if (isAddAssignmentWorkflow) {
        e.preventDefault();
        showStatus('Please finish adding the assignment before adding reminders.', 'info');
        return false;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const assignmentId = button.dataset.assignmentId;
    if (assignmentId) {
        addReminder(assignmentId, button);
    }
    return false;
}

function handleAISummaryButtonClick(e) {
    const button = e.target.closest('.btn-generate-ai-summary');
    if (!button) return;

    if (isSyncInProgress) {
        e.preventDefault();
        showStatus('Please wait for sync to finish before generating summaries.', 'info');
        return false;
    }
    if (isInsightsModalLoading) {
        e.preventDefault();
        showStatus('Please wait for AI insights to finish before generating summaries.', 'info');
        return false;
    }
    if (activeAISummaryRequests > 0) {
        e.preventDefault();
        showStatus('Another AI summary is generating. Please wait...', 'info');
        return false;
    }
    if (isAddAssignmentWorkflow) {
        e.preventDefault();
        showStatus('Please finish adding the assignment before generating summaries.', 'info');
        return false;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const assignmentId = button.dataset.assignmentId;
    if (assignmentId) {
        generateAISummary(assignmentId, button);
    }
    return false;
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
                buttonElement.textContent = '✓ Generated';
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

function updateStats(assignmentsToCount = null) {
    const assignmentsToUse = assignmentsToCount !== null ? assignmentsToCount : assignments;

    const total = assignmentsToUse.filter(a => a && !a.deleted && a.status !== 'Completed').length;

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
function selectAllAssignments() {
    const visibleAssignments = Array.from(document.querySelectorAll('.assignment-card'));
    if (visibleAssignments.length === 0) return;

    const allSelected = visibleAssignments.every(card => {
        const checkbox = card.querySelector('.assignment-checkbox');
        return checkbox && checkbox.checked;
    });

    visibleAssignments.forEach(card => {
        const checkbox = card.querySelector('.assignment-checkbox');
        if (checkbox) {
            const assignmentId = card.dataset.assignmentId;
            checkbox.checked = !allSelected;
            toggleAssignmentSelection(assignmentId, !allSelected);
        }
    });
}

async function markAsCompleted(assignmentId) {
    try {
        await updateAssignmentField(assignmentId, 'status', 'Completed');
        showStatus('Assignment marked as completed', 'success');
        await loadAssignments();
        loadCompletedAssignments();
        updateStats();
    } catch (error) {
        showStatus('Error marking as completed: ' + error.message, 'error');
    }
}

async function reopenAssignment(assignmentId) {
    try {
        await updateAssignmentField(assignmentId, 'status', 'Not Started');
        showStatus('Assignment reopened', 'success');
        await loadAssignments();
        loadCompletedAssignments();
        updateStats();
    } catch (error) {
        showStatus('Error reopening assignment: ' + error.message, 'error');
    }
}

async function loadCompletedAssignments() {
    try {
        const completed = assignments.filter(a => a && a.status === 'Completed' && !a.deleted);
        const container = document.getElementById('completedAssignmentsList');

        if (completed.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px; font-style: italic;">No completed assignments</p>';
            return;
        }

        container.innerHTML = completed.map(assignment => {
            const completedDate = assignment.updated_at ? new Date(assignment.updated_at) : new Date();
            return `
                <div class="completed-assignment-card" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; margin-bottom: 10px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #4caf50;">
                    <div>
                        <div style="font-weight: 600; margin-bottom: 5px;">${escapeHtml(assignment.title)}</div>
                        <div style="font-size: 0.85em; color: #666;">
                            ${escapeHtml(assignment.course_name)} • Completed ${completedDate.toLocaleDateString()}
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-secondary" onclick="reopenAssignment('${escapeHtml(assignment.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px;">Reopen</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading completed assignments:', error);
    }
}

function toggleCompletedSection() {
    const modal = document.getElementById('completedModal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    loadCompletedAssignments();
}

function closeCompletedModal() {
    const modal = document.getElementById('completedModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
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
        return `
            <div class="deleted-assignment-card">
                <div>
                    <div style="font-weight: 600; margin-bottom: 5px;">${escapeHtml(item.title)}</div>
                    <div style="font-size: 0.85em; color: #666;">
                        ${escapeHtml(item.course_name)} • Deleted ${deletedDate.toLocaleDateString()}
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="restoreAssignment('${escapeHtml(item.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px;">Restore</button>
                    <button class="btn btn-secondary" onclick="permanentlyDeleteAssignment('${escapeHtml(item.assignment_id)}')" style="font-size: 0.85em; padding: 6px 12px; background: #d32f2f;">Delete Forever</button>
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
        const response = await fetch('/api/assignments/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignment_id: assignmentId })
        });
        const data = await response.json();
        if (data.success) {
            showStatus('Assignment restored', 'success');
            loadAssignments();
            displayDeletedAssignments();
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
            displayDeletedAssignments();
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
            showStatus('Assignment deleted', 'success');
            loadAssignments();
            displayDeletedAssignments();
        } else {
            showStatus('Error: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Error deleting assignment: ' + error.message, 'error');
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
                        <h3 style="margin: 0; color: #f57c00;">⚠️ Watch Out</h3>${confidenceStars}
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

function bulkMarkComplete() {
    if (selectedAssignments.size === 0) return;
    bulkUpdateAssignments(Array.from(selectedAssignments), { status: 'Completed' });
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
            if (field === 'status' && value === 'Completed') {
                loadCompletedAssignments();
            }
        } else {
            throw new Error(data.error || 'Failed to update assignment');
        }
    } catch (error) {
        console.error('Error updating assignment:', error);
        throw error;
    }
}

let currentNotesAssignmentId = null;

function openNotesModal(assignmentId) {
    const assignment = assignments.find(a => a.assignment_id === assignmentId);
    if (!assignment) return;

    currentNotesAssignmentId = assignmentId;
    const modal = document.getElementById('notesModal');
    const titleElement = document.getElementById('notesAssignmentTitle');
    const textarea = document.getElementById('notesTextarea');

    let title = assignment.title || 'Untitled Assignment';
    if (title) {
        const tmp = document.createElement('div');
        tmp.innerHTML = title;
        title = tmp.textContent || tmp.innerText || '';
    }

    titleElement.textContent = title;
    textarea.value = assignment.user_notes || '';

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    textarea.focus();
}

function closeNotesModal() {
    const modal = document.getElementById('notesModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    currentNotesAssignmentId = null;
}

async function saveNotes() {
    if (!currentNotesAssignmentId) return;

    const textarea = document.getElementById('notesTextarea');
    const notes = textarea.value.trim();

    try {
        await updateAssignmentField(currentNotesAssignmentId, 'user_notes', notes);
        showStatus('Notes saved successfully', 'success');
        closeNotesModal();
    } catch (error) {
        showStatus('Error saving notes: ' + error.message, 'error');
    }
}

async function openAddAssignmentModal() {
    if (activeAISummaryRequests > 0 || isSyncInProgress || isInsightsModalLoading || activeAddReminderRequests > 0) {
        showStatus('Please wait for current operation to finish before adding a new assignment.', 'info');
        return;
    }
    isAddAssignmentWorkflow = true;
    refreshPrimaryButtonsState();
    const modal = document.getElementById('addAssignmentModal');
    const courseSelect = document.getElementById('addAssignmentCourse');
    const customCourseInput = document.getElementById('addAssignmentCourseCustom');
    const customReminderInput = document.getElementById('addAssignmentManualReminder');
    const existingWarning = modal.querySelector('#addAssignmentWarning');
    if (existingWarning) {
        existingWarning.style.display = 'none';
    }

    await loadCourses();

    document.getElementById('addAssignmentTitle').value = '';
    document.getElementById('addAssignmentDescription').value = '';
    const dueInput = document.getElementById('addAssignmentDueDate');
    dueInput.value = '';
    dueInput.setAttribute('type', 'datetime-local');
    dueInput.onfocus = null;
    dueInput.onblur = null;
    dueInput.removeAttribute('placeholder');
    dueInput.removeAttribute('inputmode');
    document.getElementById('addAssignmentNotes').value = '';

    courseSelect.innerHTML = '<option value="">Select a course</option>';
    let hasValidCourses = false;

    courses.forEach(course => {
        const courseName = course.name || course.course_name;
        const reminderList = course.reminder_list || '';
        const enabled = course.enabled !== false;

        if (enabled && reminderList && reminderList.trim() !== '') {
            const option = document.createElement('option');
            option.value = courseName;
            option.textContent = courseName;
            courseSelect.appendChild(option);
            hasValidCourses = true;
        }
    });

    const otherOption = document.createElement('option');
    otherOption.value = '__other__';
    otherOption.textContent = 'Other';
    courseSelect.appendChild(otherOption);
    hasValidCourses = true;

    customCourseInput.style.display = 'none';
    customCourseInput.value = '';
    customReminderInput.style.display = 'none';
    customReminderInput.value = '';
    courseSelect.onchange = () => {
        if (courseSelect.value === '__other__') {
            customCourseInput.style.display = 'block';
            customCourseInput.focus();
            customReminderInput.style.display = 'block';
        } else {
            customCourseInput.style.display = 'none';
            customCourseInput.value = '';
            customReminderInput.style.display = 'none';
            customReminderInput.value = '';
        }
    };
    courseSelect.value = '';

    if (!hasValidCourses) {
        showStatus('Please add at least one course with a reminder list in Settings first.', 'error');
        return;
    }

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.getElementById('addAssignmentTitle').focus();
}

function closeAddAssignmentModal() {
    const modal = document.getElementById('addAssignmentModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    if (!isAddingAssignment) {
        isAddAssignmentWorkflow = false;
        refreshPrimaryButtonsState();
    }
}

function showAddAssignmentWarning(message) {
    const modal = document.getElementById('addAssignmentModal');
    if (!modal || modal.style.display !== 'block') {
        showStatus(message, 'error');
        return;
    }
    let warning = modal.querySelector('#addAssignmentWarning');
    if (!warning) {
        warning = document.createElement('div');
        warning.id = 'addAssignmentWarning';
        warning.style.background = '#f8d7da';
        warning.style.border = '2px solid #d32f2f';
        warning.style.borderRadius = '8px';
        warning.style.color = '#721c24';
        warning.style.padding = '12px 14px';
        warning.style.marginBottom = '14px';
        warning.style.fontWeight = '600';
        const content = modal.querySelector('.modal-content');
        content.insertBefore(warning, content.firstChild);
    }
    warning.textContent = message;
    warning.style.display = 'block';
}

let isAddingAssignment = false;

async function saveAddAssignment() {
    if (isAddingAssignment) {
        return;
    }

    isAddAssignmentWorkflow = true;
    refreshPrimaryButtonsState();

    const title = document.getElementById('addAssignmentTitle').value.trim();
    const selectedCourse = document.getElementById('addAssignmentCourse').value;
    const customCourseName = document.getElementById('addAssignmentCourseCustom').value.trim();
    const customReminderName = document.getElementById('addAssignmentManualReminder').value.trim();
    const dueDate = document.getElementById('addAssignmentDueDate').value;
    const description = document.getElementById('addAssignmentDescription').value.trim();
    const userNotes = document.getElementById('addAssignmentNotes').value.trim();

    if (!title) {
        showAddAssignmentWarning('Please enter an assignment title');
        return;
    }
    if (!selectedCourse) {
        showAddAssignmentWarning('Please select a course');
        return;
    }
    if (selectedCourse === '__other__' && !customCourseName) {
        showAddAssignmentWarning('Please enter a course name');
        return;
    }
    if (selectedCourse === '__other__' && !customReminderName) {
        showAddAssignmentWarning('Please enter a reminder list name');
        return;
    }
    if (!dueDate) {
        showAddAssignmentWarning('Please select a due date');
        return;
    }

    isAddingAssignment = true;
    const saveBtn = document.getElementById('saveAddAssignmentBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Adding...';
    refreshPrimaryButtonsState();
    closeAddAssignmentModal();

    const progressContainer = document.getElementById('syncProgress');
    const progressText = document.getElementById('syncProgressText');
    const progressTime = document.getElementById('syncProgressTime');
    const progressCount = document.getElementById('syncProgressCount');
    const progressTop = document.querySelector('#syncProgress .sync-progress-top');
    progressContainer.style.display = 'block';
    progressText.textContent = 'Adding assignment...';
    progressTime.textContent = '';
    if (progressCount) progressCount.textContent = '';
    if (progressTop) progressTop.style.display = 'none';

    try {
        let finalCourseName = selectedCourse;
        let reminderList = '';
        if (selectedCourse === '__other__') {
            finalCourseName = customCourseName;
            reminderList = customReminderName;
            try {
                await fetch('/api/course-mapping', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course_name: finalCourseName, reminder_list: reminderList })
                });
            } catch (e) {}
        } else {
            const course = courses.find(c => (c.name || c.course_name) === selectedCourse);
            if (!course) {
                throw new Error('Selected course not found');
            }
            reminderList = course.reminder_list || '';
            if (!reminderList || reminderList.trim() === '') {
                throw new Error('Selected course does not have a reminder list set');
            }
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
                course_name: finalCourseName,
                reminder_list: reminderList,
                user_notes: userNotes
            })
        });

        const data = await response.json();
        if (data.success) {
            progressText.textContent = '✓ Assignment added successfully!';
            await loadAssignments();
            updateStats();

            const shouldWaitForAISummary = !!description && aiSummaryEnabled;
            if (shouldWaitForAISummary) {
                progressText.textContent = 'Generating AI summary...';
                try {
                    const genResp = await fetch('/api/assignments/generate-ai-summary', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ assignment_id: assignmentId })
                    });
                    const genData = await genResp.json();
                    if (genData && genData.error) {
                        showStatus('AI summary generation error: ' + genData.error, 'error');
                    }
                } catch (e) {
                    showStatus('AI summary generation error: ' + (e.message || 'Unknown'), 'error');
                }

                const aiReady = await waitForAISummary(assignmentId, 2500, 60000);
                if (!aiReady) {
                    showStatus('AI summary generation is taking longer than expected. You can continue.', 'info');
                } else {
                    progressText.textContent = '✓ AI summary generated!';
                }
            }

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
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add Assignment';
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

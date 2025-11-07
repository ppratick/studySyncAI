# studySyncAI

An AI-powered study management system that syncs Canvas assignments and discussion posts to Apple Reminders with intelligent analysis and personalized study planning.

## Features

- **Canvas Integration**: Automatically syncs assignments and discussion posts from Canvas LMS
- **AI Enhancement**: Uses Google Gemini 2.5 Flash to analyze assignments and provide study insights
- **Smart Study Planning**: Generates personalized study strategies based on workload and deadlines
- **Apple Reminders Integration**: Seamlessly adds assignments to macOS Reminders app
- **SQLite Database**: Persistent storage for assignments, course mappings, and settings
- **Modular Architecture**: Clean, organized codebase with separate modules
- **Command Line Interface**: Run with `--ai` flag for AI-enhanced mode
- **Web Dashboard**: Beautiful web interface for viewing and managing assignments

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd studySyncAI
   ```

2. **Create virtual environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**
   Create a `.env` file with your API keys:
   ```
   CANVAS_API_TOKEN=your_canvas_token
   CANVAS_DOMAIN=your_canvas_domain
   GEMINI_API_KEY=your_gemini_key
   ```

5. **Run the application**

   **Command Line Interface (CLI Version):**
   - Uses database: `cli/backend/studysync-cli.db`
   - Simple CLI without course enable/disable features
   - ```bash
     # Standard mode
     python3 cli/main.py
     
     # AI-enhanced mode
     python3 cli/main.py --ai
     ```

   **Web Dashboard (Web Version):**
   - Uses database: `web/backend/studysync-web.db`
   - Full-featured web interface with course management
   - ```bash
     python3 web/app.py
     ```
     Then open your browser to `http://localhost:5001`
   
   **Note**: The CLI and Web versions use separate databases, so course mappings and settings are independent between the two versions.

## Environment Variables

- `CANVAS_API_TOKEN`: Your Canvas API token
- `CANVAS_DOMAIN`: Your Canvas domain (e.g., `cmu.instructure.com`)
- `GEMINI_API_KEY`: Your Google Gemini API key

## Architecture

```
studySyncAI/
├── cli/
│   ├── main.py              # CLI entry point and orchestration
│   └── backend/             # CLI backend modules
│       ├── canvas_api.py
│       ├── assignment_processor.py
│       ├── ai_enhancer.py
│       ├── reminders_manager.py
│       └── database.py
├── web/
│   ├── app.py               # Flask web server and API endpoints
│   ├── frontend/            # Web dashboard (HTML, CSS, JavaScript)
│   │   ├── index.html
│   │   └── static/
│   │       ├── css/
│   │       └── js/
│   └── backend/             # Web backend modules
│       ├── canvas_api.py
│       ├── assignment_processor.py
│       ├── ai_enhancer.py
│       ├── reminders_manager.py
│       └── database.py
├── venv/                    # Shared virtual environment
├── README.md
└── .gitignore
```

## Known Issues

### Discussion Post Completion Detection

**Issue**: Completed discussion posts may still be added to reminders on subsequent runs.

**Cause**: Canvas API returns 403 Forbidden errors when trying to access discussion entries, preventing the script from detecting if a student has participated in a discussion.

**Workaround**: Manually mark discussion posts as completed in Canvas. The script will respect this status on future runs.

**Status**: Known limitation due to Canvas API restrictions.

## Contributing

This project is part of a Human-AI Interaction course project. Contributions and improvements are welcome!

# studySyncAI

An AI-powered study management system that syncs Canvas assignments and discussion posts to Apple Reminders with intelligent analysis and personalized study planning.

## Features

- **Canvas Integration**: Automatically syncs assignments and discussion posts from Canvas LMS
- **AI Enhancement**: Uses Google Gemini 2.5 Flash to analyze assignments and provide study insights
- **Smart Study Planning**: Generates personalized study strategies based on workload and deadlines
- **Apple Reminders Integration**: Seamlessly adds assignments to macOS Reminders app
- **SQLite Database**: Persistent storage for assignments, course mappings, and settings
- **Modular Architecture**: Clean, organized codebase with separate modules

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd StudySync-AI-v2
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
   ```bash
   cp example.txt .env
   # Edit .env with your API keys and Canvas domain
   ```

5. **Run the application**
   ```bash
   python3 main.py
   ```

## Environment Variables

- `CANVAS_API_TOKEN`: Your Canvas API token
- `CANVAS_DOMAIN`: Your Canvas domain (e.g., `cmu.instructure.com`)
- `GEMINI_API_KEY`: Your Google Gemini API key

## Architecture

- `main.py`: Main entry point and orchestration
- `backend/canvas_api.py`: Canvas API interactions
- `backend/assignment_processor.py`: Assignment processing logic
- `backend/ai_enhancer.py`: AI-powered assignment analysis
- `backend/reminders_manager.py`: Apple Reminders integration
- `backend/database.py`: SQLite database operations

## Known Issues

### 🐛 Discussion Post Completion Detection

**Issue**: Completed discussion posts may still be added to reminders on subsequent runs.

**Cause**: Canvas API returns 403 Forbidden errors when trying to access discussion entries, preventing the script from detecting if a student has participated in a discussion.

**Workaround**: Manually mark discussion posts as completed in Canvas. The script will respect this status on future runs.

**Status**: Known limitation due to Canvas API restrictions.

## Contributing

This project is part of a Human-AI Interaction course project. Contributions and improvements are welcome!

## License

MIT License

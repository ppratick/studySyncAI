# StudySync AI

AI-powered study management system that syncs Canvas assignments to Apple Reminders with intelligent analysis.

## Features

- 📚 Syncs assignments from Canvas LMS
- 🤖 AI-powered insights and summaries (Google Gemini)
- 📅 Adds assignments to Apple Reminders
- 💻 Web dashboard and CLI tool

## Setup

### 1. Install Dependencies

```bash
git clone git@github.com:ppratick/studySyncAI.git
cd studySyncAI
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install flask requests google-generativeai python-dotenv
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
CANVAS_API_TOKEN=your_canvas_api_token_here
CANVAS_DOMAIN=your-school.instructure.com
GEMINI_API_KEY=your_gemini_api_key_here
```

**Get API keys:**
- **Canvas**: Canvas → Account → Settings → New Access Token
- **Gemini**: [Google AI Studio](https://makersuite.google.com/app/apikey)

## Usage

### Web Dashboard (Recommended)

```bash
cd web
python3 app.py
```

Open `http://localhost:5001` in your browser.

**First-time setup:**
1. Enter college/university name
2. Set reminder list names for each course
3. Choose whether to enable AI summaries
4. Click "Save & Sync"

### CLI Tool

```bash
cd cli
python3 main.py        # Standard mode
python3 main.py --ai   # AI-enhanced mode
```

## Important Notes

- **Same venv**: Use the same virtual environment for both CLI and Web
- **Separate databases**: CLI and Web use separate databases (settings are independent)
- **Canvas favorites**: Only favorited courses are synced
- **macOS required**: Apple Reminders integration requires macOS

## Project Structure

```
studySyncAI/
├── cli/              # CLI tool
├── web/              # Web dashboard
├── venv/             # Virtual environment (shared)
└── .env              # Environment variables
```

## Troubleshooting

- **Canvas errors**: Verify API token and domain in `.env`
- **Reminders not working**: Ensure macOS and Reminders app access
- **AI not working**: Check GEMINI_API_KEY in `.env` (optional feature)

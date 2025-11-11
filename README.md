# StudySync AI

AI-powered study management system that syncs Canvas assignments to Apple Reminders with intelligent analysis.

## Features

- 📚 Syncs assignments from Canvas LMS
- 🤖 AI-powered insights and summaries (Ollama)
- 📅 Adds assignments to Apple Reminders
- 💻 Web dashboard

## Setup

### 1. Install Dependencies

```bash
git clone git@github.com:ppratick/studySyncAI.git
cd studySyncAI
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install flask requests python-dotenv
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
CANVAS_API_TOKEN=your_canvas_api_token_here
CANVAS_DOMAIN=your-school.instructure.com
OLLAMA_MODEL=your_ollama_model_name  # Optional, for AI features (e.g., llama3.2, mistral)
```

**Get API keys:**
- **Canvas**: Canvas → Account → Settings → New Access Token
- **Ollama**: Install from [ollama.ai](https://ollama.ai) and pull a model (e.g., `ollama pull llama3.2`)

## Usage

```bash
python3 app.py
```

Open `http://localhost:5001` in your browser.

**First-time setup:**
1. Enter college/university name
2. Set reminder list names for each course
3. Choose whether to enable AI summaries
4. Click "Save & Sync"

## Important Notes

- **Canvas favorites**: Only favorited courses are synced
- **macOS required**: Apple Reminders integration requires macOS
- **AI features**: Require Ollama to be running locally (`ollama serve`)

## Project Structure

```
studySyncAI/
├── app.py            # Web dashboard (Flask app)
├── backend.py        # Backend code
├── index.html        # Web UI
├── app.js            # Web frontend JavaScript
├── style.css         # Web UI styles
├── venv/             # Virtual environment
└── .env              # Environment variables
```

## Troubleshooting

- **Canvas errors**: Verify API token and domain in `.env`
- **Reminders not working**: Ensure macOS and Reminders app access
- **AI not working**: Check `OLLAMA_MODEL` in `.env` and ensure Ollama is running (`ollama serve`)

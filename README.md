# StudySync AI

A tool to sync Canvas assignments to Apple Reminders with optional AI-powered summaries and insights.

## Setup

1. Install dependencies:
   ```bash
   pip install flask requests python-dotenv
   ```

2. Create a `.env` file with your Canvas credentials:
   ```
   CANVAS_API_TOKEN=your_canvas_api_token
   CANVAS_DOMAIN=your_canvas_domain
   OLLAMA_MODEL=your_ollama_model (optional, for AI features)
   ```

3. Run the web application:
   ```bash
   python3 app.py
   ```

4. Open your browser to `http://127.0.0.1:5001`

## CLI Usage

Sync assignments to Apple Reminders:
```bash
python3 cli.py
```

With AI summaries:
```bash
python3 cli.py --ai
```

## Requirements

- Python 3.8+
- Canvas API token
- macOS (for Apple Reminders integration)
- Ollama (optional, for AI features)


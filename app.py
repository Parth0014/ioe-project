"""Run `python app.py` for the complete local energy monitor.

Importing this module remains a separate hosted WSGI entrypoint; local startup
never requires hosting credentials, sign-in, or the hosted dashboard.
"""

if __name__ == '__main__':
    import subprocess
    import sys
    from pathlib import Path

    # Let `python app.py` work even when the shell resolved a different Python.
    # Re-enter through the project's installed environment without activation.
    root = Path(__file__).resolve().parent
    project_python = root / '.venv-cloud' / 'Scripts' / 'python.exe'
    if (project_python.is_file()
            and Path(sys.executable).resolve() != project_python.resolve()
            and 'server' not in sys.modules):
        raise SystemExit(subprocess.call([str(project_python), str(Path(__file__).resolve()), *sys.argv[1:]], cwd=root))
    from server import main
    main()
else:
    from cloud_dashboard import create_app
    app = create_app()

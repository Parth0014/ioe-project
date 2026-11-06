"""Run `python app.py` for the complete local energy monitor.

Importing this module remains a separate hosted WSGI entrypoint; local startup
never requires hosting credentials, sign-in, or the hosted dashboard.
"""

if __name__ == '__main__':
    from server import main
    main()
else:
    from cloud_dashboard import create_app
    app = create_app()

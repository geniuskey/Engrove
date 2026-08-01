import uvicorn


def run() -> None:
    uvicorn.run("engrove_worker.app:app", host="0.0.0.0", port=8000, access_log=False)


if __name__ == "__main__":
    run()

from flask import Flask
from flask import send_from_directory


app = Flask(__name__)


@app.route("/")
def index():
    return send_from_directory("./", "acps-story.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory("./", filename)


if __name__ == '__main__':
    app.run(debug=True)
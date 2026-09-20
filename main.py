from flask import Flask
from flask import send_from_directory


app = Flask(__name__)


@app.route("/")
def index():
    return send_from_directory("./","map.html")


if __name__ == '__main__':
    app.run(debug=True)
import json

import httpx
import pytest

from arcloom.cli import main
from arcloom.domain import DomainError
from tests.conftest import ADMIN, RUNNER


def invoke_doctor(monkeypatch, runtime, handler):
    monkeypatch.setattr("sys.argv", ["arcloom", "doctor"])
    monkeypatch.setattr("arcloom.config.Settings", lambda: runtime.settings)
    monkeypatch.setattr("arcloom.runtime.Runtime", lambda settings: runtime)
    client_class = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs),
    )
    main()


def health(_):
    return httpx.Response(200, json={"status": "ok", "environment": "synthetic-asgi-lab"})


@pytest.mark.parametrize(
    "failure", ["connection", "unauthorized", "http_error", "invalid_json", "wrong_service"]
)
def test_doctor_reports_lab_failure_without_traceback_or_secrets(
    monkeypatch, runtime, capsys, failure
):
    sensitive = "private-upstream-data-" + RUNNER

    def handler(request):
        if failure == "connection":
            raise httpx.ConnectError(sensitive, request=request)
        if failure == "unauthorized":
            return httpx.Response(401, json={"detail": sensitive})
        if failure == "http_error":
            return httpx.Response(503, json={"detail": sensitive})
        if failure == "invalid_json":
            return httpx.Response(200, content=sensitive)
        return httpx.Response(
            200, json={"status": "ok", "environment": "unrelated-service", "secret": sensitive}
        )

    with pytest.raises(SystemExit) as error:
        invoke_doctor(monkeypatch, runtime, handler)
    output = capsys.readouterr()
    assert error.value.code == 1
    result = json.loads(output.out)
    assert result["status"] == "not_ready"
    assert result["graph_ready"] is True
    assert result["errors"][0]["component"] == "lab"
    assert ADMIN not in output.out + output.err
    assert sensitive not in output.out + output.err
    assert "Traceback" not in output.err


def test_doctor_reports_graph_outage_and_still_checks_lab(monkeypatch, runtime, capsys):
    runtime.graph.available = False
    with pytest.raises(SystemExit) as error:
        invoke_doctor(monkeypatch, runtime, health)
    result = json.loads(capsys.readouterr().out)
    assert error.value.code == 1
    assert result["status"] == "not_ready" and result["graph_ready"] is False
    assert result["lab"]["status"] == "ok"
    assert result["errors"][0]["component"] == "graph"


def test_doctor_auth_failure_is_structured_and_secret_free(monkeypatch, runtime, capsys):
    def fail(_):
        raise DomainError("unauthorized", "Sensitive diagnostic " + ADMIN, 401)

    monkeypatch.setattr(runtime.auth, "bearer", fail)
    with pytest.raises(SystemExit) as error:
        invoke_doctor(monkeypatch, runtime, health)
    output = capsys.readouterr()
    assert error.value.code == 1
    assert json.loads(output.out)["error"]["code"] == "unauthorized"
    assert ADMIN not in output.out + output.err


def test_doctor_success_requires_expected_lab_health(monkeypatch, runtime, capsys):
    invoke_doctor(monkeypatch, runtime, health)
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "ready"
    assert result["graph_ready"] and result["audit"]["valid"]

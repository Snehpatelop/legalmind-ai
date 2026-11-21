from app.security import create_access_token, decode_access_token, hash_password, verify_password


def test_password_hashing_roundtrip():
    h = hash_password("correct horse battery")
    assert h != "correct horse battery"
    assert verify_password("correct horse battery", h)
    assert not verify_password("wrong", h)


def test_jwt_roundtrip_and_tamper():
    token = create_access_token("abc")
    assert decode_access_token(token) == "abc"
    assert decode_access_token(token[:-2] + "xx") is None


def test_register_login_me(client):
    r = client.post("/api/auth/register", json={"name": "Ada", "email": "ada@example.com", "password": "password123"})
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "ada@example.com"
    assert "password_hash" not in r.json()["user"]

    dup = client.post("/api/auth/register", json={"name": "Ada", "email": "ADA@example.com", "password": "password123"})
    assert dup.status_code == 409

    bad = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope-nope"})
    assert bad.status_code == 401

    ok = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "password123"})
    assert ok.status_code == 200
    token = ok.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["name"] == "Ada"


def test_validation_errors(client):
    r = client.post("/api/auth/register", json={"name": "X", "email": "not-an-email", "password": "short"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_protected_routes_require_auth(client):
    for path in ["/api/auth/me", "/api/documents", "/api/chat/conversations", "/api/dashboard/stats", "/api/evaluation/results"]:
        assert client.get(path).status_code == 401
    assert client.get("/api/documents", headers={"Authorization": "Bearer garbage"}).status_code == 401

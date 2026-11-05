from .models import User


def register(email: str):
    try:
        return User.objects.create(email=email)
    except Exception:
        return None

from django.db import IntegrityError, transaction

from .models import User


def active_users():
    return list(User.objects.filter(active=True).values("id", "email"))


@transaction.atomic
def register(email: str) -> User:
    try:
        return User.objects.create(email=email)
    except IntegrityError as error:  # nobypass-allow EXC001: translate duplicate email into a domain error
        raise ValueError(f"{email} is already registered") from error

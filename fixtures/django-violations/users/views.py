from django.db import connection
from django.http import JsonResponse

from .models import User


def user_list(request):
    # "Quick fix" from an AI agent: query straight from the view.
    users = list(User.objects.filter(active=True).values("id", "email"))
    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM users_user")
    return JsonResponse({"users": users})

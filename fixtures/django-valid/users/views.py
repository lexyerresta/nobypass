from django.http import JsonResponse

from . import services


def user_list(request):
    return JsonResponse({"users": services.active_users()})

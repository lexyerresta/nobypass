from django.urls import path

from users import views

urlpatterns = [path("users/", views.user_list)]

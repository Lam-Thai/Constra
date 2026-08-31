from django.urls import path

from . import views

urlpatterns = [
    path("drawings/", views.DrawingListView.as_view(), name="drawing-list"),
    path("drawings/<uuid:id>/", views.DrawingDetailView.as_view(), name="drawing-detail"),
    path(
        "drawings/<uuid:id>/pages/<int:page>/annotations/",
        views.PageAnnotationListView.as_view(),
        name="page-annotation-list",
    ),
    path("annotations/<uuid:id>/", views.AnnotationDetailView.as_view(), name="annotation-detail"),
]

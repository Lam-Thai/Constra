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
    # --- AI Takeoff -> Estimate (see SPEC.md) ---
    path("drawings/<uuid:id>/ocr/", views.DrawingOcrView.as_view(), name="drawing-ocr"),
    path("drawings/<uuid:id>/estimate/", views.DrawingEstimateView.as_view(), name="drawing-estimate"),
    path("drawings/<uuid:id>/estimates/", views.DrawingEstimateListView.as_view(), name="drawing-estimate-list"),
    path("estimates/<uuid:id>/", views.EstimateDetailView.as_view(), name="estimate-detail"),
    path("estimates/<uuid:id>/export.csv", views.EstimateExportCsvView.as_view(), name="estimate-export-csv"),
    path("estimates/<uuid:id>/report/", views.EstimateReportView.as_view(), name="estimate-report"),
    # Note: unit-prices/template.csv and unit-prices/import/ are registered
    # before unit-prices/<uuid:id>/ so those literal path segments aren't
    # swallowed by the <uuid:id> converter.
    path("unit-prices/template.csv", views.UnitPriceTemplateCsvView.as_view(), name="unit-price-template-csv"),
    path("unit-prices/import/", views.UnitPriceImportView.as_view(), name="unit-price-import"),
    path("unit-prices/", views.UnitPriceListView.as_view(), name="unit-price-list"),
    path("unit-prices/<uuid:id>/", views.UnitPriceDetailView.as_view(), name="unit-price-detail"),
]

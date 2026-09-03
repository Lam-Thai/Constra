from django.contrib import admin

from .models import Annotation, Drawing, EstimateLineItem, EstimateRun, Page, UnitPrice

admin.site.register(Drawing)
admin.site.register(Page)
admin.site.register(Annotation)
admin.site.register(UnitPrice)
admin.site.register(EstimateRun)
admin.site.register(EstimateLineItem)

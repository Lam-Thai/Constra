from django.contrib import admin

from .models import Annotation, Drawing, Page

admin.site.register(Drawing)
admin.site.register(Page)
admin.site.register(Annotation)

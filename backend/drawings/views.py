import os

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Annotation, Drawing, Page
from .serializers import (
    AnnotationSerializer,
    DrawingDetailSerializer,
    DrawingListSerializer,
    DrawingUploadSerializer,
)
from .services import SourceFileError, create_drawing_from_image, create_or_update_drawing_from_pdf_bytes


class DrawingListView(APIView):
    # JSONParser is DRF's default; MultiPartParser/FormParser are needed for
    # the file-upload POST below (multipart/form-data request bodies).
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        drawings = Drawing.objects.all().order_by("name")
        return Response(DrawingListSerializer(drawings, many=True).data)

    def post(self, request):
        upload = DrawingUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        name = upload.validated_data["name"]
        uploaded_file = upload.validated_data["file"]
        ext = os.path.splitext(uploaded_file.name or "")[1].lower()

        try:
            if ext == ".pdf":
                pdf_bytes = uploaded_file.read()
                drawing = create_or_update_drawing_from_pdf_bytes(name, pdf_bytes)
            else:
                drawing = create_drawing_from_image(name, uploaded_file)
        except SourceFileError as err:
            return Response({"file": [str(err)]}, status=status.HTTP_400_BAD_REQUEST)

        return Response(DrawingDetailSerializer(drawing).data, status=status.HTTP_201_CREATED)


class DrawingDetailView(APIView):
    def get(self, request, id):
        drawing = get_object_or_404(Drawing, id=id)
        return Response(DrawingDetailSerializer(drawing).data)


class PageAnnotationListView(APIView):
    def _get_drawing_and_page(self, id, page):
        drawing = get_object_or_404(Drawing, id=id)
        get_object_or_404(Page, drawing=drawing, page_number=page)
        return drawing

    def get(self, request, id, page):
        drawing = self._get_drawing_and_page(id, page)
        annotations = Annotation.objects.filter(drawing=drawing, page_number=page).order_by("created_at")
        return Response(AnnotationSerializer(annotations, many=True).data)

    def post(self, request, id, page):
        drawing = self._get_drawing_and_page(id, page)
        serializer = AnnotationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(drawing=drawing, page_number=page)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AnnotationDetailView(APIView):
    def patch(self, request, id):
        annotation = get_object_or_404(Annotation, id=id)
        serializer = AnnotationSerializer(annotation, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, id):
        annotation = get_object_or_404(Annotation, id=id)
        annotation_id = annotation.id
        annotation.delete()
        return Response({"id": annotation_id}, status=status.HTTP_200_OK)

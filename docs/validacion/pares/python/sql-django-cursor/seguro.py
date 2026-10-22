from django.db import connection
from django.http import JsonResponse

def buscar_usuario(request):
    nombre = request.GET.get("nombre")
    with connection.cursor() as cursor:
        cursor.execute("SELECT id, email FROM auth_user WHERE username = %s", [nombre])
        fila = cursor.fetchone()
    return JsonResponse({"usuario": fila})

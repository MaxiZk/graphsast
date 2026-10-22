import html
from django.http import HttpResponse

def comentario(request):
    texto = request.POST.get("texto", "")
    return HttpResponse(f"<p>Tu comentario: {html.escape(texto)}</p>")

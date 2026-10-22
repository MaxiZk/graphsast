import java.io.IOException;
import javax.servlet.http.*;
import org.owasp.encoder.Encode;

public class SaludoServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String nombre = request.getParameter("nombre");
        response.setContentType("text/html");
        response.getWriter().println("<h1>Hola " + Encode.forHtml(nombre) + "</h1>");
    }
}

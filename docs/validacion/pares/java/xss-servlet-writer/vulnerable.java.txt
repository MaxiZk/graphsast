import java.io.IOException;
import javax.servlet.http.*;

public class SaludoServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String nombre = request.getParameter("nombre");
        response.setContentType("text/html");
        response.getWriter().println("<h1>Hola " + nombre + "</h1>");
    }
}

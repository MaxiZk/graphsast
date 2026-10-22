import java.io.*;
import java.nio.file.Paths;
import javax.servlet.http.*;

public class DescargaServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String nombre = Paths.get(request.getParameter("archivo")).getFileName().toString();
        File archivo = new File("/srv/reportes/", nombre);
        try (InputStream in = new FileInputStream(archivo)) {
            in.transferTo(response.getOutputStream());
        }
    }
}
